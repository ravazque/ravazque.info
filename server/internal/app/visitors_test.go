package app

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestVisitorsKeepFirstAndLastSignInOnDiskAndForget(t *testing.T) {
	path := filepath.Join(t.TempDir(), "visitors.json")
	t0 := time.Date(2026, 11, 1, 10, 0, 0, 0, time.UTC)
	v := LoadVisitors(path, nil, t0)
	v.Saw("peer01", t0)
	v.Saw("peer02", t0.Add(time.Hour))
	v.Saw("peer01", t0.Add(2*time.Hour))
	got := LoadVisitors(path, nil, t0.Add(3*time.Hour)).List() // read back as after a restart
	if len(got) != 2 || got[0].Login != "peer01" || !got[0].First.Equal(t0) || !got[0].Last.Equal(t0.Add(2*time.Hour)) || got[1].Login != "peer02" {
		t.Fatalf("newest sign-in first, with the first one kept: %+v", got)
	}
	if fi, err := os.Stat(path); err != nil || fi.Mode().Perm() != 0o600 {
		t.Fatal("the file is the server's alone", err)
	}
	v.Forget("peer01") // "Delete my data"
	if got := LoadVisitors(path, nil, t0.Add(3*time.Hour)).List(); len(got) != 1 || got[0].Login != "peer02" {
		t.Fatalf("forgotten on disk too: %+v", got)
	}
	if got := LoadVisitors(path, nil, t0.Add(visitorsKeep+2*time.Hour)).List(); len(got) != 0 {
		t.Fatalf("two years after the last sign-in, gone at the next start: %+v", got)
	}
}

func TestVisitorsWithoutAFileStayInMemory(t *testing.T) {
	v := LoadVisitors("", nil, time.Now())
	v.Saw("peer01", time.Now())
	if len(v.List()) != 1 {
		t.Fatal("dev and tests keep them in memory")
	}
}

func TestVisitorsSetAnUnreadableFileAside(t *testing.T) {
	path := filepath.Join(t.TempDir(), "visitors.json")
	os.WriteFile(path, []byte("{not json"), 0o600)
	v := LoadVisitors(path, nil, time.Now())
	v.Saw("peer01", time.Now())
	if _, err := os.Stat(path + ".bad"); err != nil {
		t.Fatal("the unreadable list is kept apart, not overwritten")
	}
	if len(LoadVisitors(path, nil, time.Now()).List()) != 1 {
		t.Fatal("a new list starts")
	}
}

func TestVisitorsSeedOnceBeforeTheFirstFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "visitors.json")
	t0 := time.Date(2026, 11, 23, 12, 0, 0, 0, time.UTC)
	v := LoadVisitors(path, []string{"peer01", " Peer02 ", "peer01", "bad login!", ""}, t0)
	got := v.List()
	if len(got) != 2 || !got[0].Before || !got[0].First.Equal(t0) || !got[0].Last.IsZero() {
		t.Fatalf("each valid login once, known to have come before the record started: %+v", got)
	}
	v.Saw("peer01", t0.Add(time.Hour))
	if g := v.List()[0]; g.Login != "peer01" || !g.Before || !g.Last.Equal(t0.Add(time.Hour)) {
		t.Fatalf("a seeded one signing in again: its last sign-in, still \"before\" for the first: %+v", g)
	}
	v.Forget("peer02")
	if got := LoadVisitors(path, []string{"peer02", "peer03"}, t0.Add(2*time.Hour)).List(); len(got) != 1 || got[0].Login != "peer01" {
		t.Fatalf("the seed applies to a new file only: a deleted one never comes back: %+v", got)
	}
	if got := LoadVisitors(path, nil, t0.Add(visitorsKeep+time.Minute)).List(); len(got) != 1 {
		t.Fatalf("kept two years from its latest date: %+v", got)
	}
	if got := LoadVisitors("", []string{"peer01"}, t0).List(); len(got) != 0 {
		t.Fatal("dev (no file) never seeds")
	}
}
