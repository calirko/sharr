package main

import (
	"encoding/binary"
	"encoding/json"
	"log"
	"math"
	"sort"
	"sync"
	"time"

	"github.com/coder/websocket"
	"github.com/livekit/protocol/auth"
	"github.com/livekit/protocol/livekit"
	lksdk "github.com/livekit/server-sdk-go/v2"
	"github.com/pion/rtp"
	"github.com/pion/rtp/codecs"
	"github.com/pion/webrtc/v4"
	"github.com/pion/webrtc/v4/pkg/media/samplebuilder"
)

type config struct{ url, key, secret string }

type message struct {
	typ  websocket.MessageType
	data []byte
}

type viewer struct {
	out chan message
	mu  sync.Mutex
	// The share this viewer watches (track id, 0 = none). Only its frames are sent.
	selected uint16
	// Set until the viewer gets a keyframe: after a switch, a drop or a decode error, deltas are useless
	waitKey bool
}

func newViewer() *viewer { return &viewer{out: make(chan message, 120), waitKey: true} }

func (v *viewer) needKey() {
	v.mu.Lock()
	v.waitKey = true
	v.mu.Unlock()
}

// Control messages always go through; a full queue only drops frames
func (v *viewer) sendText(data []byte) {
	select {
	case v.out <- message{websocket.MessageText, data}:
	default:
	}
}

// Returns false when the viewer is behind and needs a keyframe
func (v *viewer) sendFrame(id uint16, data []byte, key bool) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.selected != id || (v.waitKey && !key) {
		return true
	}
	select {
	case v.out <- message{websocket.MessageBinary, data}:
		v.waitKey = false
		return true
	default:
		v.waitKey = true
		return false
	}
}

type hub struct {
	cfg   config
	mu    sync.Mutex
	rooms map[string]*room
}

func newHub(cfg config) *hub { return &hub{cfg: cfg, rooms: map[string]*room{}} }

func (h *hub) join(id string, v *viewer) *room {
	h.mu.Lock()
	defer h.mu.Unlock()
	r := h.rooms[id]
	if r != nil {
		select {
		case <-r.gone:
			r = nil
		default:
		}
	}
	if r == nil {
		r = &room{id: id, cfg: h.cfg, viewers: map[*viewer]bool{}, tracks: map[uint16]*share{}, gone: make(chan struct{})}
		h.rooms[id] = r
		go r.run()
	}
	r.add(v)
	return r
}

func (h *hub) leave(r *room, v *viewer) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if r.remove(v) == 0 {
		if h.rooms[r.id] == r {
			delete(h.rooms, r.id)
		}
		r.close()
	}
}

// One LiveKit connection per sharr room, shared by all its viewers. Subscribes to every screen
// share video; each viewer picks one and only gets that one's frames.
type room struct {
	id      string
	cfg     config
	mu      sync.Mutex
	viewers map[*viewer]bool
	lk      *lksdk.Room
	closed  bool
	tracks  map[uint16]*share
	nextID  uint16
	// Closed when the LiveKit connection ends
	gone chan struct{}
}

type share struct {
	id     uint16
	sid    string
	codec  string // vp8, h264, or the MIME type when we can't forward it
	name   string
	avatar string // Discord avatar URL from the participant's token attributes, if any
	ssrc   webrtc.SSRC
	rp     *lksdk.RemoteParticipant
}

func (r *room) add(v *viewer) {
	r.mu.Lock()
	r.viewers[v] = true
	r.mu.Unlock()
	r.announce()
}

func (r *room) remove(v *viewer) int {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.viewers, v)
	return len(r.viewers)
}

func (r *room) close() {
	r.mu.Lock()
	r.closed = true
	lk := r.lk
	r.mu.Unlock()
	if lk != nil {
		lk.Disconnect()
	}
}

func (r *room) requestKey(id uint16) {
	r.mu.Lock()
	t := r.tracks[id]
	r.mu.Unlock()
	if t != nil {
		t.rp.WritePLI(t.ssrc)
	}
}

func (r *room) selectTrack(v *viewer, id uint16) {
	r.mu.Lock()
	_, ok := r.tracks[id]
	r.mu.Unlock()
	if !ok {
		return
	}
	v.mu.Lock()
	v.selected, v.waitKey = id, true
	v.mu.Unlock()
	r.announce()
	r.requestKey(id)
}

// Sends every viewer the list of shares and the one it watches. Viewers whose share is gone
// (or who have none yet) move to the first one.
func (r *room) announce() {
	r.mu.Lock()
	list := make([]map[string]any, 0, len(r.tracks))
	ids := make([]int, 0, len(r.tracks))
	for id := range r.tracks {
		ids = append(ids, int(id))
	}
	sort.Ints(ids)
	for _, id := range ids {
		t := r.tracks[uint16(id)]
		list = append(list, map[string]any{"id": t.id, "name": t.name, "codec": t.codec, "avatar_url": t.avatar})
	}
	var keys []uint16
	for v := range r.viewers {
		v.mu.Lock()
		if _, ok := r.tracks[v.selected]; !ok {
			v.selected, v.waitKey = 0, true
			if len(ids) > 0 {
				v.selected = uint16(ids[0])
				keys = append(keys, v.selected)
			}
		}
		b, _ := json.Marshal(map[string]any{"type": "tracks", "tracks": list, "selected": v.selected})
		v.mu.Unlock()
		v.sendText(b)
	}
	r.mu.Unlock()
	for _, id := range keys {
		r.requestKey(id)
	}
}

// Frames go only to viewers watching that share. Returns true if one of them fell behind.
func (r *room) sendFrame(id uint16, data []byte, key bool) (behind bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for v := range r.viewers {
		if !v.sendFrame(id, data, key) {
			behind = true
		}
	}
	return behind
}

// Connects and stays connected until the last viewer leaves. If LiveKit drops us (the room was
// closed, say), viewers are disconnected too: reconnecting here would bring a closed room back,
// while viewers reconnect through the sharr server, which checks that the room still exists.
func (r *room) run() {
	defer close(r.gone)
	done := make(chan struct{})
	lk, err := r.connect(done)
	if err != nil {
		log.Printf("room %s: connect: %v", r.id, err)
		return
	}
	r.mu.Lock()
	r.lk = lk
	closed := r.closed
	r.mu.Unlock()
	if closed {
		lk.Disconnect()
		return
	}
	log.Printf("room %s: connected", r.id)
	go r.subscribeAll()
	<-done
	log.Printf("room %s: disconnected", r.id)
}

func (r *room) connect(done chan struct{}) (*lksdk.Room, error) {
	at := auth.NewAccessToken(r.cfg.key, r.cfg.secret)
	grant := &auth.VideoGrant{RoomJoin: true, Room: r.id, Hidden: true}
	grant.SetCanSubscribe(true)
	grant.SetCanPublish(false)
	grant.SetCanPublishData(false)
	at.SetVideoGrant(grant).SetIdentity("sharr-relay").SetName("sharr relay").SetValidFor(24 * time.Hour)
	token, err := at.ToJWT()
	if err != nil {
		return nil, err
	}

	var once sync.Once
	cb := &lksdk.RoomCallback{
		OnDisconnected: func() { once.Do(func() { close(done) }) },
		ParticipantCallback: lksdk.ParticipantCallback{
			// SDK callbacks run under its locks, so don't call back into the room from here
			OnTrackPublished:   func(pub *lksdk.RemoteTrackPublication, _ *lksdk.RemoteParticipant) { go r.subscribe(pub) },
			OnTrackUnpublished: func(pub *lksdk.RemoteTrackPublication, _ *lksdk.RemoteParticipant) { go r.dropTrack(pub.SID()) },
			OnTrackSubscribed:  r.onSubscribed,
		},
	}
	return lksdk.ConnectToRoomWithToken(r.cfg.url, token, cb, lksdk.WithAutoSubscribe(false))
}

// Shares that were already running when we joined
func (r *room) subscribeAll() {
	r.mu.Lock()
	lk := r.lk
	r.mu.Unlock()
	if lk == nil {
		return
	}
	for _, rp := range lk.GetRemoteParticipants() {
		for _, pub := range rp.TrackPublications() {
			if rpub, ok := pub.(*lksdk.RemoteTrackPublication); ok {
				r.subscribe(rpub)
			}
		}
	}
}

func (r *room) subscribe(pub *lksdk.RemoteTrackPublication) {
	if pub.Source() != livekit.TrackSource_SCREEN_SHARE || pub.Kind() != lksdk.TrackKindVideo || pub.IsSubscribed() {
		return
	}
	if err := pub.SetSubscribed(true); err != nil {
		log.Printf("room %s: subscribe: %v", r.id, err)
		return
	}
	pub.SetVideoQuality(livekit.VideoQuality_HIGH)
}

func (r *room) dropTrack(sid string) {
	r.mu.Lock()
	found := false
	for id, t := range r.tracks {
		if t.sid == sid {
			delete(r.tracks, id)
			found = true
		}
	}
	r.mu.Unlock()
	if found {
		r.announce()
	}
}

func (r *room) onSubscribed(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
	if pub.Source() != livekit.TrackSource_SCREEN_SHARE || track.Kind() != webrtc.RTPCodecTypeVideo {
		return
	}
	var depacketizer rtp.Depacketizer
	codec := track.Codec().MimeType
	switch codec {
	case webrtc.MimeTypeVP8:
		depacketizer, codec = &codecs.VP8Packet{}, "vp8"
	case webrtc.MimeTypeH264:
		depacketizer, codec = &codecs.H264Packet{}, "h264"
	default:
		log.Printf("room %s: unsupported codec %s", r.id, codec)
	}
	r.mu.Lock()
	r.nextID++
	if r.nextID == 0 {
		r.nextID = 1
	}
	t := &share{id: r.nextID, sid: pub.SID(), codec: codec, name: rp.Name(), avatar: rp.Attributes()["avatar_url"], ssrc: track.SSRC(), rp: rp}
	r.tracks[t.id] = t
	r.mu.Unlock()
	log.Printf("room %s: share %d, %s from %s", r.id, t.id, codec, rp.Name())
	r.announce()
	if depacketizer != nil {
		go r.forward(track, depacketizer, t)
	}
}

// Frame message: 1 byte flags (1 = keyframe), 2 bytes share id, 8 bytes timestamp in
// microseconds (float64), then the frame
func (r *room) forward(track *webrtc.TrackRemote, depacketizer rtp.Depacketizer, t *share) {
	sb := samplebuilder.New(512, depacketizer, track.Codec().ClockRate)
	var first uint32
	started := false
	lastPLI := time.Time{}
	for {
		pkt, _, err := track.ReadRTP()
		if err != nil {
			return
		}
		r.mu.Lock()
		current := r.tracks[t.id] == t
		r.mu.Unlock()
		if !current {
			return
		}
		sb.Push(pkt)
		for s := sb.Pop(); s != nil; s = sb.Pop() {
			if !started {
				first, started = s.PacketTimestamp, true
			}
			key := isKeyframe(t.codec, s.Data)
			us := float64(s.PacketTimestamp-first) / float64(track.Codec().ClockRate) * 1e6
			msg := make([]byte, 11+len(s.Data))
			if key {
				msg[0] = 1
			}
			binary.BigEndian.PutUint16(msg[1:3], t.id)
			binary.BigEndian.PutUint64(msg[3:11], math.Float64bits(us))
			copy(msg[11:], s.Data)
			// A gap in the samples (lost packets) breaks the decode chain until the next keyframe
			if r.sendFrame(t.id, msg, key) || s.PrevDroppedPackets > 0 {
				if time.Since(lastPLI) > time.Second {
					lastPLI = time.Now()
					r.requestKey(t.id)
				}
			}
		}
	}
}

func isKeyframe(codec string, data []byte) bool {
	if len(data) == 0 {
		return false
	}
	if codec == "vp8" {
		return data[0]&0x01 == 0
	}
	// Annex B: look for an IDR NAL unit
	for i := 0; i+3 < len(data); i++ {
		if data[i] == 0 && data[i+1] == 0 && data[i+2] == 1 && data[i+3]&0x1f == 5 {
			return true
		}
	}
	return false
}
