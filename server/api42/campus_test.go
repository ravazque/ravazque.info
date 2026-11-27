package api42

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"ravazque.info/server/core"
)

// pagedList answers a list of total items, 100 per page, ids 1..total.
func pagedList(w http.ResponseWriter, r *http.Request, total int, item func(id int) map[string]any) {
	page, _ := strconv.Atoi(r.URL.Query().Get("page[number]"))
	page = max(page, 1)
	var out []map[string]any
	for id := (page-1)*100 + 1; id <= min(page*100, total); id++ {
		out = append(out, item(id))
	}
	w.Header().Set("X-Total", strconv.Itoa(total))
	json.NewEncoder(w).Encode(out)
}

func TestPagesFoldsEveryPageOnceWithSeveralWorkers(t *testing.T) {
	var inFlight, peak atomic.Int64
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			tokenOK(w, "T")
			return
		}
		if r.URL.Query().Get("sort") != "id" {
			t.Errorf("unsorted pages: %s", r.URL.RawQuery)
		}
		n := inFlight.Add(1)
		for p := peak.Load(); n > p && !peak.CompareAndSwap(p, n); p = peak.Load() {
		}
		time.Sleep(5 * time.Millisecond)
		inFlight.Add(-1)
		pagedList(w, r, 950, func(id int) map[string]any { return map[string]any{"id": float64(id)} })
	})
	var mu sync.Mutex
	seen := map[int]int{}
	var gates atomic.Int64
	err := c.Pages(context.Background(), "/v2/things", nil, 3, func(context.Context) error { gates.Add(1); return nil }, func(batch []any) {
		mu.Lock()
		defer mu.Unlock()
		for _, x := range batch {
			seen[int(x.(map[string]any)["id"].(float64))]++
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(seen) != 950 {
		t.Fatalf("items %d", len(seen))
	}
	for id, n := range seen {
		if n != 1 {
			t.Fatalf("item %d folded %d times", id, n)
		}
	}
	if gates.Load() != 10 || peak.Load() < 2 || peak.Load() > 3 {
		t.Fatalf("gates %d, peak %d", gates.Load(), peak.Load())
	}
}

// One page failing past the client's own retries (a timeout, a run of 5xx) is asked again later, not the end of the count.
func TestPagesAsksAFailedPageAgain(t *testing.T) {
	var fails atomic.Int64
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			tokenOK(w, "T")
			return
		}
		if r.URL.Query().Get("page[number]") == "3" && fails.Add(1) <= 7 { // more than one call's retries
			w.WriteHeader(503)
			return
		}
		pagedList(w, r, 450, func(id int) map[string]any { return map[string]any{"id": float64(id)} })
	})
	var got atomic.Int64
	err := c.Pages(context.Background(), "/v2/things", nil, 2, func(context.Context) error { return nil }, func(b []any) { got.Add(int64(len(b))) })
	if err != nil || got.Load() != 450 {
		t.Fatalf("err %v, items %d", err, got.Load())
	}
}

func TestPagesStopsOnTheGatesError(t *testing.T) {
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			tokenOK(w, "T")
			return
		}
		pagedList(w, r, 950, func(id int) map[string]any { return map[string]any{"id": float64(id)} })
	})
	stop := errors.New("stop")
	var calls atomic.Int64
	err := c.Pages(context.Background(), "/v2/things", nil, 3, func(context.Context) error {
		if calls.Add(1) > 2 {
			return stop
		}
		return nil
	}, func([]any) {})
	if !errors.Is(err, stop) {
		t.Fatalf("err %v", err)
	}
}

// Campus asks the three lists with the campus and cursus filters and folds them into the count.
func TestCampusFetchesTheThreeListsFiltered(t *testing.T) {
	var asked sync.Map
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			tokenOK(w, "T")
			return
		}
		q := r.URL.Query()
		asked.Store(r.URL.Path, q.Encode())
		switch r.URL.Path {
		case "/v2/cursus/21/cursus_users":
			pagedList(w, r, 6, func(id int) map[string]any {
				return map[string]any{"begin_at": "2024-09-02T08:00:00Z", "grade": "Cadet", "blackholed_at": "2099-01-01T00:00:00Z",
					"user": map[string]any{"id": float64(900000 + id), "login": "peer0" + strconv.Itoa(id), "active?": true}}
			})
		case "/v2/projects_users":
			pagedList(w, r, 6, func(id int) map[string]any {
				return map[string]any{"status": "finished", "validated?": true, "cursus_ids": []any{21.0}, "created_at": "2025-01-01T00:00:00Z", "marked_at": "2025-01-02T00:00:00Z",
					"project": map[string]any{"slug": "42cursus-libft", "name": "Libft"}, "user": map[string]any{"id": float64(900000 + id)},
					"teams": []any{map[string]any{"id": float64(id), "final_mark": 100.0, "validated?": true, "status": "finished"}}}
			})
		case "/v2/scale_teams":
			pagedList(w, r, 0, nil)
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	})
	count := core.NewCampusCount(nil, time.Date(2026, 11, 25, 0, 0, 0, 0, time.UTC))
	if err := Campus(context.Background(), c, count, 3, func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]string{
		"/v2/cursus/21/cursus_users": "filter%5Bcampus_id%5D=22",
		"/v2/projects_users":         "filter%5Bcampus%5D=22&filter%5Bcursus%5D=21",
		"/v2/scale_teams":            "filter%5Bcampus_id%5D=22&filter%5Bcursus_id%5D=21",
	} {
		got, _ := asked.Load(path)
		if s, _ := got.(string); s == "" || !strings.Contains(s, want) {
			t.Fatalf("%s asked with %q, want %q in it", path, got, want)
		}
	}
	res := count.Result()
	if p := res["projects"].([]any)[0].(map[string]any); p["passed"] != 6 {
		t.Fatalf("row %v", p)
	}
}

// The Piscine's count asks its own lists: the C Piscine's projects (their ids, the checkpoints and other campuses' left
// out), then everyone of the C Piscine in Madrid, their attempts at those projects and the Piscine's evaluations.
func TestPiscineFetchesItsLists(t *testing.T) {
	var asked sync.Map
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			tokenOK(w, "T")
			return
		}
		asked.Store(r.URL.Path, r.URL.Query().Encode())
		switch r.URL.Path {
		case "/v2/cursus/9/projects":
			w.Write([]byte(`[{"id":11,"slug":"c-piscine-c-00"},{"id":12,"slug":"c-piscine-exam-checkpoint-00-5"},{"id":13,"slug":"eu-aceito"},{"id":14,"slug":"c-piscine-bsq"}]`))
		case "/v2/cursus/9/cursus_users":
			pagedList(w, r, 5, func(id int) map[string]any {
				return map[string]any{"begin_at": "2024-07-01T08:00:00Z", "user": map[string]any{"id": float64(900000 + id), "login": "peer0" + strconv.Itoa(id)}}
			})
		case "/v2/projects_users", "/v2/scale_teams":
			pagedList(w, r, 0, nil)
		default:
			t.Errorf("unexpected %s", r.URL.Path)
		}
	})
	count := core.NewPiscineCount(nil, time.Date(2026, 11, 25, 0, 0, 0, 0, time.UTC))
	if err := Piscine(context.Background(), c, count, 2, func(context.Context) error { return nil }); err != nil {
		t.Fatal(err)
	}
	for path, want := range map[string]string{
		"/v2/cursus/9/cursus_users": "filter%5Bcampus_id%5D=22",
		"/v2/projects_users":        "filter%5Bcampus%5D=22&filter%5Bproject_id%5D=11%2C14",
		"/v2/scale_teams":           "filter%5Bcampus_id%5D=22&filter%5Bcursus_id%5D=9",
	} {
		got, _ := asked.Load(path)
		if s, _ := got.(string); !strings.Contains(s, want) {
			t.Fatalf("%s asked with %q, want %q in it", path, got, want)
		}
	}
	if p := count.Result(nil)["people"].(map[string]any); p["total"] != 0 || p["excluded"] != 5 { // five read, none handed anything in
		t.Fatalf("people %v", p)
	}
}

// Whether a Piscine of 42 Madrid ended in a span is one request: its enrolments by end_at, one row at most.
func TestPiscineEnded(t *testing.T) {
	var asked atomic.Value
	rows := "[]"
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/oauth/token" {
			tokenOK(w, "T")
			return
		}
		asked.Store(r.URL.Path + "?" + r.URL.Query().Encode())
		w.Write([]byte(rows))
	})
	from, to := time.Date(2026, 11, 16, 3, 0, 0, 0, time.UTC), time.Date(2026, 11, 23, 3, 0, 0, 0, time.UTC)
	gates := 0
	gate := func(context.Context) error { gates++; return nil }
	if ended, err := PiscineEnded(context.Background(), c, gate, from, to); err != nil || ended {
		t.Fatalf("none ended: %v %v", ended, err)
	}
	want := "/v2/cursus/9/cursus_users?filter%5Bcampus_id%5D=22&page%5Bsize%5D=1&range%5Bend_at%5D=2026-11-16T03%3A00%3A00Z%2C2026-11-23T03%3A00%3A00Z"
	if got := asked.Load(); got != want {
		t.Fatalf("asked %v\nwant  %s", got, want)
	}
	rows = `[{"end_at":"2026-11-20T15:00:00.000Z"}]`
	if ended, err := PiscineEnded(context.Background(), c, gate, from, to); err != nil || !ended || gates != 2 {
		t.Fatalf("one ended: %v %v (gates %d)", ended, err, gates)
	}
}
