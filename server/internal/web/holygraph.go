package web

import (
	"io"
	"log/slog"
	"net/http"
	"os"

	"ravazque.info/server/core"
)

// The holy graph the owner draws in the editor (make dev): kept in HOLYGRAPH_FILE, read by the Holy graph page of every
// signed-in user in place of the one built into the app; it reaches production by the editor's download and Server
// stats' import (the same PUT), and DELETE goes back to the built-in one.

func (s *Server) loadHolyGraph() {
	if s.S.HolyGraph == "" {
		return
	}
	if b, err := os.ReadFile(s.S.HolyGraph); err == nil && core.CheckHolyGraph(b) == nil {
		s.holy.Store(&b)
	}
}

// holyGraph: the owner's holy graph, or 204 when the built-in one stands.
func (s *Server) holyGraph(w http.ResponseWriter, r *http.Request, si signedIn) {
	b := s.holy.Load()
	if b == nil {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Write(*b)
}

func (s *Server) holyGraphSave(w http.ResponseWriter, r *http.Request, si signedIn) {
	if !s.isOwner(si.u) {
		writeJSON(w, 403, errBody("owner"))
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 2<<20+1))
	if err != nil || len(b) > 2<<20 {
		writeJSON(w, 400, errBody("size"))
		return
	}
	if err := core.CheckHolyGraph(b); err != nil {
		writeJSON(w, 400, map[string]string{"error": "not-a-holy-graph", "why": err.Error()})
		return
	}
	if p := s.S.HolyGraph; p != "" {
		if err := os.WriteFile(p+".tmp", b, 0o600); err != nil || os.Rename(p+".tmp", p) != nil {
			writeJSON(w, 500, errBody("disk"))
			return
		}
	}
	s.holy.Store(&b)
	slog.Info("holy graph saved by the owner", "bytes", len(b))
	writeJSON(w, 200, map[string]bool{"ok": true})
}

func (s *Server) holyGraphReset(w http.ResponseWriter, r *http.Request, si signedIn) {
	if !s.isOwner(si.u) {
		writeJSON(w, 403, errBody("owner"))
		return
	}
	if p := s.S.HolyGraph; p != "" {
		os.Remove(p)
	}
	s.holy.Store(nil)
	w.WriteHeader(http.StatusNoContent)
}
