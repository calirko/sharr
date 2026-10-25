package main

import (
	"encoding/binary"
	"encoding/json"
	"log"
	"math"
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
	// Set until the viewer gets a keyframe: after a drop or a decode error, deltas are useless
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
func (v *viewer) sendFrame(data []byte, key bool) bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.waitKey && !key {
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
		r = &room{id: id, cfg: h.cfg, viewers: map[*viewer]bool{}, gone: make(chan struct{})}
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

// One LiveKit connection per sharr room, shared by all its viewers
type room struct {
	id      string
	cfg     config
	mu      sync.Mutex
	viewers map[*viewer]bool
	lk      *lksdk.Room
	closed  bool
	// The share being forwarded. Only one for now: the first screen share video.
	track *activeTrack
	// Subscribed, waiting for the track to arrive
	pending bool
	// Closed when the LiveKit connection ends
	gone chan struct{}
}

type activeTrack struct {
	sid   string
	codec string
	name  string
	ssrc  webrtc.SSRC
	rp    *lksdk.RemoteParticipant
}

func (r *room) add(v *viewer) {
	r.mu.Lock()
	r.viewers[v] = true
	t := r.track
	r.mu.Unlock()
	v.sendText(trackMessage(t))
	r.requestKey()
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

func (r *room) requestKey() {
	r.mu.Lock()
	t := r.track
	r.mu.Unlock()
	if t != nil {
		t.rp.WritePLI(t.ssrc)
	}
}

func (r *room) broadcastText(data []byte) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for v := range r.viewers {
		v.sendText(data)
	}
}

func (r *room) broadcastFrame(data []byte, key bool) (behind bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	for v := range r.viewers {
		if !v.sendFrame(data, key) {
			behind = true
		}
	}
	return behind
}

func trackMessage(t *activeTrack) []byte {
	m := map[string]string{"type": "none"}
	if t != nil {
		m = map[string]string{"type": "track", "codec": t.codec, "name": t.name}
	}
	b, _ := json.Marshal(m)
	return b
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
	go r.pickTrack()
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
			OnTrackPublished: func(pub *lksdk.RemoteTrackPublication, _ *lksdk.RemoteParticipant) { go r.subscribe(pub) },
			OnTrackUnpublished: func(pub *lksdk.RemoteTrackPublication, _ *lksdk.RemoteParticipant) {
				r.mu.Lock()
				gone := r.track != nil && r.track.sid == pub.SID()
				r.mu.Unlock()
				if gone {
					r.setTrack(nil)
					go r.pickTrack()
				}
			},
			OnTrackSubscribed: r.onSubscribed,
		},
	}
	return lksdk.ConnectToRoomWithToken(r.cfg.url, token, cb, lksdk.WithAutoSubscribe(false))
}

// Subscribes to the first screen share video if nothing is being forwarded
func (r *room) pickTrack() {
	r.mu.Lock()
	lk := r.lk
	r.mu.Unlock()
	if lk == nil {
		return
	}
	for _, rp := range lk.GetRemoteParticipants() {
		for _, pub := range rp.TrackPublications() {
			if rpub, ok := pub.(*lksdk.RemoteTrackPublication); ok && r.subscribe(rpub) {
				return
			}
		}
	}
}

func (r *room) subscribe(pub *lksdk.RemoteTrackPublication) bool {
	if pub.Source() != livekit.TrackSource_SCREEN_SHARE || pub.Kind() != lksdk.TrackKindVideo {
		return false
	}
	r.mu.Lock()
	busy := r.track != nil || r.pending
	if !busy {
		r.pending = true
	}
	r.mu.Unlock()
	if busy {
		return false
	}
	if err := pub.SetSubscribed(true); err != nil {
		log.Printf("room %s: subscribe: %v", r.id, err)
		r.mu.Lock()
		r.pending = false
		r.mu.Unlock()
		return false
	}
	pub.SetVideoQuality(livekit.VideoQuality_HIGH)
	return true
}

func (r *room) setTrack(t *activeTrack) {
	r.mu.Lock()
	r.track = t
	r.pending = false
	r.mu.Unlock()
	r.broadcastText(trackMessage(t))
}

func (r *room) onSubscribed(track *webrtc.TrackRemote, pub *lksdk.RemoteTrackPublication, rp *lksdk.RemoteParticipant) {
	if pub.Source() != livekit.TrackSource_SCREEN_SHARE || track.Kind() != webrtc.RTPCodecTypeVideo {
		return
	}
	var depacketizer rtp.Depacketizer
	var codec string
	switch track.Codec().MimeType {
	case webrtc.MimeTypeVP8:
		depacketizer, codec = &codecs.VP8Packet{}, "vp8"
	case webrtc.MimeTypeH264:
		depacketizer, codec = &codecs.H264Packet{}, "h264"
	default:
		log.Printf("room %s: unsupported codec %s", r.id, track.Codec().MimeType)
		r.broadcastText([]byte(`{"type":"unsupported","codec":"` + track.Codec().MimeType + `"}`))
		return
	}
	t := &activeTrack{sid: pub.SID(), codec: codec, name: rp.Name(), ssrc: track.SSRC(), rp: rp}
	r.setTrack(t)
	log.Printf("room %s: forwarding %s from %s", r.id, codec, rp.Name())
	r.requestKey()
	go r.forward(track, depacketizer, t)
}

// Frame message: 1 byte flags (1 = keyframe), 8 bytes timestamp in microseconds (float64), frame data
func (r *room) forward(track *webrtc.TrackRemote, depacketizer rtp.Depacketizer, t *activeTrack) {
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
		current := r.track == t
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
			msg := make([]byte, 9+len(s.Data))
			if key {
				msg[0] = 1
			}
			binary.BigEndian.PutUint64(msg[1:9], math.Float64bits(us))
			copy(msg[9:], s.Data)
			// A gap in the samples (lost packets) breaks the decode chain until the next keyframe
			if r.broadcastFrame(msg, key) || s.PrevDroppedPackets > 0 {
				if time.Since(lastPLI) > time.Second {
					lastPLI = time.Now()
					r.requestKey()
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
