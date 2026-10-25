// sharr-relay: forwards screen share video from LiveKit to Discord Activity viewers over a
// websocket. Discord blocks WebRTC inside Activities, so viewers decode the frames with
// WebCodecs instead. Frames are passed through as they arrive, nothing is re-encoded.
package main

import (
	"context"
	"log"
	"net/http"
	"os"
	"regexp"
	"time"

	"github.com/coder/websocket"
)

var roomID = regexp.MustCompile(`^[A-Za-z0-9_-]{1,32}$`)

func env(name, fallback string) string {
	if v := os.Getenv(name); v != "" {
		return v
	}
	return fallback
}

func main() {
	cfg := config{
		url:    env("LIVEKIT_WS_URL", "ws://localhost:7880"),
		key:    os.Getenv("LIVEKIT_API_KEY"),
		secret: os.Getenv("LIVEKIT_API_SECRET"),
	}
	if cfg.key == "" || cfg.secret == "" {
		log.Fatal("LIVEKIT_API_KEY and LIVEKIT_API_SECRET are required")
	}
	hub := newHub(cfg)

	// Only the sharr server connects here, it checks the channel to room link first
	http.HandleFunc("/stream", func(w http.ResponseWriter, r *http.Request) {
		room := r.URL.Query().Get("room")
		if !roomID.MatchString(room) {
			http.Error(w, "bad room", http.StatusBadRequest)
			return
		}
		conn, err := websocket.Accept(w, r, nil)
		if err != nil {
			return
		}
		conn.SetReadLimit(1024)
		serveViewer(r.Context(), hub, room, conn)
	})

	addr := ":" + env("RELAY_PORT", "7890")
	log.Printf("sharr-relay on %s", addr)
	srv := &http.Server{Addr: addr, ReadHeaderTimeout: 10 * time.Second}
	log.Fatal(srv.ListenAndServe())
}

func serveViewer(ctx context.Context, hub *hub, room string, conn *websocket.Conn) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	v := newViewer()
	r := hub.join(room, v)
	defer hub.leave(r, v)

	// The only message viewers send is "key", after a decode error
	go func() {
		defer cancel()
		for {
			_, msg, err := conn.Read(ctx)
			if err != nil {
				return
			}
			if string(msg) == "key" {
				v.needKey()
				r.requestKey()
			}
		}
	}()

	for {
		select {
		case <-ctx.Done():
			conn.Close(websocket.StatusNormalClosure, "")
			return
		case <-r.gone:
			conn.Close(websocket.StatusGoingAway, "room connection ended")
			return
		case m := <-v.out:
			wctx, wcancel := context.WithTimeout(ctx, 10*time.Second)
			err := conn.Write(wctx, m.typ, m.data)
			wcancel()
			if err != nil {
				return
			}
		}
	}
}
