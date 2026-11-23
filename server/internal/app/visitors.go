package app

import (
	"encoding/json"
	"log/slog"
	"os"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

// Who signed in, for the owner's Server stats (privacy policy v5): each login with its first and last sign-in, in
// VISITORS_LOG (one JSON file, rewritten whole through a temp file), gone with "Delete my data" and two years after the
// last sign-in. Without a path (dev, tests) the list stays in memory. Before: the login came before the record started
// (VISITORS_SEED, on First's date); its real first sign-in is unknown, and Last stays empty until it signs in again.
type Visitor struct {
	Login  string    `json:"login"`
	First  time.Time `json:"first"`
	Last   time.Time `json:"last,omitzero"`
	Before bool      `json:"before,omitempty"`
}

// latest: the date retention counts from.
func (x Visitor) latest() time.Time {
	if x.Last.After(x.First) {
		return x.Last
	}
	return x.First
}

var loginRe = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,19}$`)

type Visitors struct {
	mu   sync.Mutex
	path string
	by   map[string]Visitor
}

const visitorsKeep = consentKeep

// LoadVisitors reads the list at start-up and drops whoever has not signed in for two years. seed (VISITORS_SEED: the
// logins that used the site before the record existed) is taken only while there is no file yet, so a login removed with
// "Delete my data" never comes back at a restart.
func LoadVisitors(path string, seed []string, now time.Time) *Visitors {
	v := &Visitors{path: path, by: map[string]Visitor{}}
	if path == "" {
		return v
	}
	b, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		at := now.UTC().Truncate(time.Second)
		for _, l := range seed {
			if l = strings.ToLower(strings.TrimSpace(l)); loginRe.MatchString(l) {
				v.by[l] = Visitor{Login: l, First: at, Before: true}
			}
		}
		if len(v.by) > 0 {
			v.save()
			slog.Info("visitors", "seeded", len(v.by))
		}
		return v
	}
	var list []Visitor
	if err == nil {
		err = json.Unmarshal(b, &list)
	}
	if err != nil { // kept apart for the owner to look at; a new list starts rather than writing over it
		slog.Error("visitors", "error", err.Error())
		os.Rename(path, path+".bad")
		return v
	}
	for _, x := range list {
		if now.Sub(x.latest()) < visitorsKeep {
			v.by[x.Login] = x
		}
	}
	if len(v.by) != len(list) {
		v.save()
	}
	return v
}

// Saw notes a sign-in: the first one stays, the last one moves.
func (v *Visitors) Saw(login string, at time.Time) {
	at = at.UTC().Truncate(time.Second)
	v.mu.Lock()
	defer v.mu.Unlock()
	x, ok := v.by[login]
	if !ok {
		x = Visitor{Login: login, First: at}
	}
	x.Last = at
	v.by[login] = x
	v.save()
}

// Forget is "Delete my data".
func (v *Visitors) Forget(login string) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if _, ok := v.by[login]; ok {
		delete(v.by, login)
		v.save()
	}
}

// List: the latest sign-in first.
func (v *Visitors) List() []Visitor {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.sorted()
}

func (v *Visitors) sorted() []Visitor {
	out := make([]Visitor, 0, len(v.by))
	for _, x := range v.by {
		out = append(out, x)
	}
	slices.SortFunc(out, func(a, b Visitor) int {
		if c := b.latest().Compare(a.latest()); c != 0 {
			return c
		}
		return strings.Compare(a.Login, b.Login)
	})
	return out
}

// save writes the whole list (the caller holds mu) through a temp file: a crash never leaves it half written.
func (v *Visitors) save() {
	if v.path == "" {
		return
	}
	b, _ := json.Marshal(v.sorted())
	tmp := v.path + ".tmp"
	err := os.WriteFile(tmp, b, 0o600)
	if err == nil {
		err = os.Rename(tmp, v.path)
	}
	if err != nil {
		slog.Error("visitors", "error", err.Error())
	}
}
