package web

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"
	"slices"
	"strings"
	"sync/atomic"
	"time"

	"ravazque.info/server/api42"
	"ravazque.info/server/core"
)

// campusReserve: the requests per app and hour the campus count leaves for people signing in.
const campusReserve = 400

var errCampusBusy = errors.New("campus count already running")

// startMaintenance closes the site to everyone but the owner until endMaintenance (Monday's count); until is shown.
func (s *Server) startMaintenance(until time.Time) { s.maint.Store(&until) }
func (s *Server) endMaintenance()                  { s.maint.Store(nil) }

// loadCampus reads the last count kept on disk (CAMPUS_STATS), if any.
func (s *Server) loadCampus() {
	if s.S.CampusStats == "" {
		return
	}
	if b, err := os.ReadFile(s.S.CampusStats); err == nil && json.Valid(b) {
		b = core.DropLogins(b, s.S.OptoutLogins) // excluded since that count
		s.campus.Store(&b)
	}
}

// The Piscine's part of Monday's count (owner, 2026-11-26): a Piscine that ended doesn't change but for its admissions,
// so it is read again only when piscineDue says so.
const (
	piscineAdmission = 42 * 24 * time.Hour // after a Piscine ends, when its admissions are read once more
	piscineMaxAge    = 56 * 24 * time.Hour // and the Piscine is read at least this often (late marks, erased accounts)
)

// piscineHead: the Piscine part of the count kept, when it was read and the opted-out students it left out (optoutPrint).
type piscineHead struct {
	Raw        json.RawMessage
	At, Optout string
}

func (s *Server) lastPiscine() piscineHead {
	b := s.campus.Load()
	if b == nil {
		return piscineHead{}
	}
	var last struct {
		At      string          `json:"generated_at"`
		Piscine json.RawMessage `json:"piscine"`
	}
	if json.Unmarshal(*b, &last) != nil || len(last.Piscine) == 0 || string(last.Piscine) == "null" {
		return piscineHead{}
	}
	var p struct {
		At     string `json:"generated_at"`
		Optout string `json:"optout"`
	}
	json.Unmarshal(last.Piscine, &p)
	if p.At == "" {
		p.At = last.At // a count before 2026-11-26 read its Piscine with the rest
	}
	return piscineHead{last.Piscine, p.At, p.Optout}
}

// optoutPrint stands for the opted-out students without naming them (an HMAC under the session secret): another list,
// or a count from another server, reads the Piscine again.
func (s *Server) optoutPrint() string {
	logins := make([]string, len(s.S.OptoutLogins))
	for i, l := range s.S.OptoutLogins {
		logins[i] = strings.ToLower(l)
	}
	slices.Sort(logins)
	m := hmac.New(sha256.New, []byte(s.S.SessionSecret))
	m.Write([]byte("campus-optout\n" + strings.Join(logins, "\n")))
	return hex.EncodeToString(m.Sum(nil))[:32]
}

// piscineDue: whether Monday's count reads the Piscine again, and why. A Piscine running doesn't make it: its figures are
// a few percent of everyone's and its admissions can't be known yet; they come the Monday after it ends.
func piscineDue(h piscineHead, print string, now time.Time, ended func(from, to time.Time) (bool, error)) (bool, string) {
	at, err := time.Parse(time.RFC3339, h.At)
	switch {
	case h.Raw == nil || err != nil:
		return true, "none"
	case h.Optout != print:
		return true, "optout"
	case now.Sub(at) > piscineMaxAge:
		return true, "old"
	}
	for _, w := range []struct {
		back time.Duration
		why  string
	}{{0, "ended"}, {piscineAdmission, "admissions"}} {
		yes, err := ended(at.Add(-w.back), now.Add(-w.back))
		if err != nil {
			return true, "unknown"
		}
		if yes {
			return true, w.why
		}
	}
	return false, ""
}

// runCampus counts 42 Madrid's 42cursus (core.CampusCount) and keeps only the totals, in memory and on disk; the C
// Piscine too when full (the owner's count) or piscineDue (Monday's), else the last one stays. It goes at one request per
// second per app at most, half of what the apps allow, and waits for the next hour while no app has more than
// campusReserve requests left, so people signing in always go first.
func (s *Server) runCampus(ctx context.Context, now func() time.Time, full bool) error {
	if !s.campusOn.CompareAndSwap(false, true) {
		return errCampusBusy
	}
	defer s.campusOn.Store(false)
	started := now()
	count := core.NewCampusCount(s.S.OptoutLogins, started)
	var requests atomic.Int64
	tick := time.NewTicker(time.Second / time.Duration(max(s.Lim.Apps(), 1)))
	defer tick.Stop()
	gate := func(ctx context.Context) error {
		reserve := campusReserve
		if s.maint.Load() != nil { // the site is closed: the count may take nearly the whole hour
			reserve = 60
		}
		for !s.Lim.Spare(reserve) {
			t := now()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-time.After(t.Truncate(time.Hour).Add(time.Hour).Sub(t)):
			}
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
		}
		requests.Add(1)
		return nil
	}
	err := api42.Campus(ctx, s.API, count, s.Lim.Apps(), gate)
	if err != nil {
		slog.Warn("campus count failed", "requests", requests.Load(), "seconds", int(now().Sub(started).Seconds()), "error", err.Error())
		return err
	}
	res := count.Result()
	// then the C Piscine (everyone who did it), when it may have changed; if only that part fails, the last one stays
	head, print, due, why := s.lastPiscine(), s.optoutPrint(), true, "full"
	if !full {
		due, why = piscineDue(head, print, started, func(from, to time.Time) (bool, error) { return api42.PiscineEnded(ctx, s.API, gate, from, to) })
	}
	piscine := core.NewPiscineCount(s.S.OptoutLogins, started)
	if !due {
		res["piscine"], why = head.Raw, "kept"
	} else if err := api42.Piscine(ctx, s.API, piscine, s.Lim.Apps(), gate); err != nil {
		slog.Warn("campus count: the Piscine failed, the last one kept", "error", err.Error())
		if head.Raw != nil {
			res["piscine"] = head.Raw
		}
	} else {
		p := piscine.Result(count.Admitted())
		p["generated_at"], p["optout"] = started.UTC().Format(time.RFC3339), print
		res["piscine"] = p
	}
	took := int(now().Sub(started).Seconds())
	res["generated_at"], res["requests"], res["seconds"] = started.UTC().Format(time.RFC3339), requests.Load(), took
	b, err := json.Marshal(res)
	if err != nil {
		return err
	}
	s.keepCampus(b)
	slog.Info("campus count", "requests", requests.Load(), "seconds", took, "piscine", why) // totals only, never anyone
	return nil
}

// nextCampusRun: Monday 04:00 in Madrid, or a minute from now when there is no count or it is over a week old.
func nextCampusRun(now time.Time, generatedAt string) time.Duration {
	if t, err := time.Parse(time.RFC3339, generatedAt); err != nil || now.Sub(t) > 7*24*time.Hour {
		return time.Minute
	}
	m := now.In(core.Madrid)
	next := time.Date(m.Year(), m.Month(), m.Day(), 4, 0, 0, 0, core.Madrid)
	for next.Weekday() != time.Monday || !next.After(m) {
		next = next.AddDate(0, 0, 1)
	}
	return next.Sub(m)
}

func (s *Server) campusGeneratedAt() string {
	var head struct {
		At string `json:"generated_at"`
	}
	if b := s.campus.Load(); b != nil {
		json.Unmarshal(*b, &head)
	}
	return head.At
}

// FollowCampus runs the count on its schedule until Close: up to three tries an hour apart, then the next Monday.
// make dev never counts by itself (the owner starts it from the API).
func (s *Server) FollowCampus() {
	if s.S.DevProfiles != "" {
		return
	}
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	go func() { <-s.stop; cancel() }()
	pause := func(d time.Duration) bool {
		select {
		case <-s.stop:
			return false
		case <-time.After(d):
			return true
		}
	}
	gaveUp := false
	for {
		at := s.campusGeneratedAt()
		if gaveUp { // three failures: wait for the next Monday rather than retry every minute
			at, gaveUp = s.now().UTC().Format(time.RFC3339), false
		}
		if !pause(nextCampusRun(s.now(), at)) {
			return
		}
		gaveUp = true
		// the site closes while it counts (owner, 2026-11-25): about as long as the last count took, 90 minutes the first time
		took := 90 * time.Minute
		if b := s.campus.Load(); b != nil {
			var last struct {
				Seconds int `json:"seconds"`
			}
			if json.Unmarshal(*b, &last) == nil && last.Seconds > 0 {
				took = time.Duration(last.Seconds) * time.Second
			}
		}
		for try := 0; try < 3; try++ {
			s.startMaintenance(s.now().Add(took)) // open again between tries: only the counting itself closes the site
			err := s.runCampus(ctx, s.now, false)
			s.endMaintenance()
			if err == nil || errors.Is(err, errCampusBusy) {
				gaveUp = false
				break
			}
			if !pause(time.Hour) {
				return
			}
		}
	}
}

// keepCampus makes b the count shown, in memory and on disk (temp file, then rename).
func (s *Server) keepCampus(b []byte) {
	b = core.DropLogins(b, s.S.OptoutLogins) // an imported count may predate someone's exclusion
	if p := s.S.CampusStats; p != "" {
		if err := os.WriteFile(p+".tmp", b, 0o600); err != nil || os.Rename(p+".tmp", p) != nil {
			slog.Warn("campus count not written to disk")
		}
	}
	s.campus.Store(&b)
}

// campusExport: the owner takes the count made here (make dev) to put it in production with campusImport.
func (s *Server) campusExport(w http.ResponseWriter, r *http.Request, si signedIn) {
	if !s.isOwner(si.u) {
		writeJSON(w, 403, errBody("owner"))
		return
	}
	b := s.campus.Load()
	if b == nil {
		writeJSON(w, 404, errBody("no-count"))
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Content-Disposition", `attachment; filename="campus.json"`)
	w.Write(*b)
}

// campusImport: the owner puts a count made elsewhere in place, over HTTPS with their session and CSRF token; only a
// campus count is taken (core.CheckCampusStats: its shape, and nothing about anyone).
func (s *Server) campusImport(w http.ResponseWriter, r *http.Request, si signedIn) {
	if !s.isOwner(si.u) {
		writeJSON(w, 403, errBody("owner"))
		return
	}
	b, err := io.ReadAll(io.LimitReader(r.Body, 8<<20+1))
	if err != nil || len(b) > 8<<20 {
		writeJSON(w, 400, errBody("size"))
		return
	}
	if err := core.CheckCampusStats(b); err != nil {
		writeJSON(w, 400, map[string]string{"error": "not-a-count", "why": err.Error()})
		return
	}
	s.keepCampus(b)
	slog.Info("campus count imported by the owner", "bytes", len(b))
	writeJSON(w, 200, map[string]any{"ok": true})
}

// campusStats: the last count, for signed-in users only.
func (s *Server) campusStats(w http.ResponseWriter, r *http.Request, si signedIn) {
	var stats json.RawMessage
	if b := s.campus.Load(); b != nil {
		stats = *b
	}
	writeJSON(w, 200, map[string]any{"running": s.campusOn.Load(), "stats": stats})
}

// campusRun: the owner starts a count now.
func (s *Server) campusRun(w http.ResponseWriter, r *http.Request, si signedIn) {
	if !s.isOwner(si.u) {
		writeJSON(w, 403, errBody("owner"))
		return
	}
	if s.campusOn.Load() {
		writeJSON(w, 409, errBody("running"))
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 6*time.Hour)
	stop, now := s.stop, s.now // taken before the goroutine: tests swap the clock
	go func() {
		defer cancel()
		go func() {
			select {
			case <-stop:
				cancel()
			case <-ctx.Done():
			}
		}()
		s.runCampus(ctx, now, true)
	}()
	writeJSON(w, 202, map[string]bool{"running": true})
}
