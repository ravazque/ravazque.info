package api42

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"ravazque.info/server/api42/fake42"
	"ravazque.info/server/core"
)

var goldenNow = time.Date(2026, 10, 28, 12, 0, 0, 0, time.UTC)

func readJSON(t *testing.T, path string) map[string]any {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	var v map[string]any
	if err := json.Unmarshal(b, &v); err != nil {
		t.Fatal(err)
	}
	return v
}

func TestExtractMatchesV1(t *testing.T) {
	for _, key := range []string{"new", "mid", "alumni"} {
		t.Run(key, func(t *testing.T) {
			d := readJSON(t, "../core/testdata/api/"+key+".json")
			c, _ := newTestClient(t, fake42.Handler(d, func(p string) { t.Errorf("unexpected request %s", p) }))
			var last float64
			report, err := Extract(context.Background(), c, int(d["user"].(map[string]any)["id"].(float64)),
				func(f float64) {
					if f < last {
						t.Errorf("progress went back: %v after %v", f, last)
					}
					last = f
				}, func() time.Time { return goldenNow })
			if err != nil {
				t.Fatal(err)
			}
			if last != 1 {
				t.Fatalf("progress ended at %v", last)
			}
			wantReq, _ := os.ReadFile("../core/testdata/golden/" + key + ".requests")
			if got := strconv.Itoa(c.Requests()); got != strings.TrimSpace(string(wantReq)) {
				t.Errorf("requests %s, v1 made %s", got, strings.TrimSpace(string(wantReq)))
			}
			gb, _ := json.Marshal(report)
			g, _ := core.ParseOrdered(gb)
			wb, _ := os.ReadFile("../core/testdata/golden/" + key + ".report.json")
			w, _ := core.ParseOrdered(wb)
			if diff := core.JSONDiff(g, w, "$"); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestRefusedUser(t *testing.T) {
	d := readJSON(t, "../core/testdata/api/mid.json")
	d["user"].(map[string]any)["staff?"] = true
	c, _ := newTestClient(t, fake42.Handler(d, func(p string) { t.Errorf("unexpected request %s", p) }))
	_, err := Extract(context.Background(), c, int(d["user"].(map[string]any)["id"].(float64)), func(float64) {}, func() time.Time { return goldenNow })
	var refused core.AccessRefused
	if !errorsAs(err, &refused) || refused.Reason != "staff" || c.Requests() != 1 {
		t.Fatalf("err %v after %d requests", err, c.Requests())
	}
}

func TestBlackholedIsRefusedUnlessAnyAccount(t *testing.T) {
	d := readJSON(t, "../core/testdata/api/mid.json")
	for _, cu := range d["user"].(map[string]any)["cursus_users"].([]any) {
		if cu := cu.(map[string]any); cu["cursus_id"] == float64(core.MainCursus) {
			cu["end_at"] = "2026-01-01T00:00:00.000Z"
		}
	}
	uid := int(d["user"].(map[string]any)["id"].(float64))
	c, _ := newTestClient(t, fake42.Handler(d, func(p string) { t.Errorf("unexpected request %s", p) }))
	var refused core.AccessRefused
	if _, err := Extract(context.Background(), c, uid, func(float64) {}, func() time.Time { return goldenNow }); !errorsAs(err, &refused) || refused.Reason != "blackholed" {
		t.Fatalf("the site refuses a blackholed student: %v", err)
	}
	c.AnyAccount = true // make dev-real's own reports
	if report, err := Extract(context.Background(), c, uid, func(float64) {}, func() time.Time { return goldenNow }); err != nil || len(report.Obj("periods").Keys()) == 0 {
		t.Fatalf("dev tools extract anyone: %v", err)
	}
}

func TestHiddenEvaluationsStayOutOfTheAnalysis(t *testing.T) {
	d := readJSON(t, "../core/testdata/api/mid.json")
	recv := d["evals_received"].([]any)
	hidden := map[string]any{"id": 7999999.0, "begin_at": "2026-10-29T15:30:00.000Z", "corrector": "invisible", "correcteds": []any{},
		"team": recv[0].(map[string]any)["team"], "scale": map[string]any{"duration": 1800.0}}
	d["evals_received"] = append(recv, hidden)
	c, _ := newTestClient(t, fake42.Handler(d, func(p string) { t.Errorf("unexpected request %s", p) }))
	report, err := Extract(context.Background(), c, int(d["user"].(map[string]any)["id"].(float64)), func(float64) {}, func() time.Time { return goldenNow })
	if err != nil {
		t.Fatal(err)
	}
	for _, e := range report.Obj("periods").Obj("all").Os("received") {
		if e.F("id") == 7999999 {
			t.Fatal("the hidden evaluation reached the analysis")
		}
	}
}

func errorsAs(err error, target any) bool { return errors.As(err, target) }

// One contact the API refuses (seen live: a 401 on another student's given evaluations) leaves that contact out of
// the network instead of failing the whole extraction.
func TestRefusedContactIsSkipped(t *testing.T) {
	d := readJSON(t, "../core/testdata/api/mid.json")
	uid := strconv.Itoa(int(d["user"].(map[string]any)["id"].(float64)))
	fake := fake42.Handler(d, func(p string) { t.Errorf("unexpected request %s", p) })
	var mu sync.Mutex
	refused, hits := "", 0
	c, _ := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if strings.HasSuffix(p, "/scale_teams/as_corrector") && !strings.Contains(p, "/users/"+uid+"/") {
			mu.Lock()
			if refused == "" {
				refused = p
			}
			hit := p == refused
			if hit {
				hits++
			}
			mu.Unlock()
			if hit {
				w.WriteHeader(401)
				return
			}
		}
		fake(w, r)
	})
	if _, err := Extract(context.Background(), c, int(d["user"].(map[string]any)["id"].(float64)), func(float64) {}, func() time.Time { return goldenNow }); err != nil {
		t.Fatal(err)
	}
	if hits == 0 {
		t.Fatal("no contact was refused")
	}
}

// A student who had a Piscine coalition (Madrid's since July 2025) keeps its points apart from the 42cursus coalition's:
// the report gets piscine_coalition (the coalition and its points), the main coalition's figures stay as they were.
func TestExtractKeepsThePiscineCoalitionApart(t *testing.T) {
	d := readJSON(t, "../core/testdata/api/mid.json")
	main := core.Objs(d, "coalitions_users")[0]
	d["coalitions"] = append(d["coalitions"].([]any), map[string]any{"id": 9101.0, "name": "Corvus", "slug": "42madrid-corvus", "color": "#4A6FA5"})
	d["coalitions_users"] = append(d["coalitions_users"].([]any), map[string]any{"id": 9201.0, "coalition_id": 9101.0, "user_id": main["user_id"], "score": 1234.0, "rank": 7.0})
	d["scores_by_coalitions_user"] = map[string]any{"9201": []any{
		map[string]any{"value": 30.0, "scoreable_type": "ScaleTeam", "scoreable_id": 1.0, "calculation_id": 1.0, "created_at": "2025-07-10T10:00:00.000Z"},
		map[string]any{"value": 12.0, "scoreable_type": "ProjectsUser", "scoreable_id": 2.0, "calculation_id": 2.0, "created_at": "2025-07-20T10:00:00.000Z"},
	}}
	c, _ := newTestClient(t, fake42.Handler(d, func(p string) { t.Errorf("unexpected request %s", p) }))
	report, err := Extract(context.Background(), c, int(d["user"].(map[string]any)["id"].(float64)), func(float64) {}, func() time.Time { return goldenNow })
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(report)
	var out struct {
		Periods map[string]struct {
			Piscine *struct {
				Coalition map[string]any `json:"coalition"`
				Points    map[string]any `json:"points"`
			} `json:"piscine_coalition"`
			Points map[string]any `json:"coalition_points"`
		} `json:"periods"`
	}
	json.Unmarshal(raw, &out)
	all := out.Periods["all"]
	if all.Piscine == nil || all.Piscine.Coalition["name"] != "Corvus" || all.Piscine.Coalition["rank"] != 7.0 || all.Piscine.Points["total"] != 42.0 {
		t.Fatalf("piscine coalition %+v", all.Piscine)
	}
	if all.Points["total"] == 42.0 {
		t.Fatal("the Piscine's points were added to the 42cursus coalition's")
	}
}
