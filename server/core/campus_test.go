package core

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"
)

// Synthetic campus: fake ids from 900001, peerNN logins. Nothing here comes from a real record.

var campusNow = time.Date(2026, 11, 25, 12, 0, 0, 0, time.UTC)

func cursusUser(uid int, login, grade, begin, blackhole string, active, staff bool) any {
	var bh any
	if blackhole != "" {
		bh = blackhole
	}
	var g any
	if grade != "" {
		g = grade
	}
	return map[string]any{"id": float64(uid + 50000), "begin_at": begin, "grade": g, "blackholed_at": bh,
		"user": map[string]any{"id": float64(uid), "login": login, "staff?": staff, "active?": active, "alumni?": grade == "Alumni"}}
}

type tm struct {
	id        int
	mark      any
	validated any
	status    string
	created   string
}

func projectUser(id, uid int, slug, status string, validated any, mark any, created, marked string, teams ...tm) any {
	var ts []any
	for _, t := range teams {
		ts = append(ts, map[string]any{"id": float64(t.id), "final_mark": t.mark, "validated?": t.validated, "status": t.status, "created_at": t.created})
	}
	var mk any
	if marked != "" {
		mk = marked
	}
	return map[string]any{"id": float64(id), "status": status, "validated?": validated, "final_mark": mark, "created_at": created, "marked_at": mk, "cursus_ids": []any{21.0},
		"project": map[string]any{"id": float64(1000 + len(slug)), "slug": slug, "name": "Name of " + slug},
		"user":    map[string]any{"id": float64(uid), "login": fmt.Sprintf("peer%02d", uid-900000)}, "teams": ts}
}

func evaluation(team int, flag string, positive bool, mark any) any {
	return map[string]any{"final_mark": mark, "flag": map[string]any{"name": flag, "positive": positive}, "team": map[string]any{"id": float64(team)}}
}

func campusResult(t *testing.T, c *CampusCount) map[string]any {
	t.Helper()
	raw, err := json.Marshal(c.Result())
	if err != nil {
		t.Fatal(err)
	}
	var out map[string]any
	json.Unmarshal(raw, &out)
	return out
}

func projectRow(t *testing.T, out map[string]any, slug string) map[string]any {
	t.Helper()
	for _, p := range out["projects"].([]any) {
		if p.(map[string]any)["slug"] == slug {
			return p.(map[string]any)
		}
	}
	t.Fatalf("no row for %s", slug)
	return nil
}

// many makes n people sharing one state, so the figures clear the "fewer than 5" rule.
func many(from, n int, grade, begin, blackhole string, active bool) []any {
	var out []any
	for i := range n {
		out = append(out, cursusUser(from+i, fmt.Sprintf("peer%02d", from+i-900000), grade, begin, blackhole, active, false))
	}
	return out
}

// handedIn: a closed Libft for each of uids, so they count (whoever handed nothing in counts nowhere).
func handedIn(uids ...int) []any {
	var out []any
	for _, uid := range uids {
		out = append(out, projectUser(400000+uid-900000, uid, "42cursus-libft", "finished", true, 100.0, "2024-09-10T00:00:00Z", "2024-09-20T00:00:00Z", tm{1000000 + uid, 100.0, true, "finished", "2024-09-10T00:00:00Z"}))
	}
	return out
}

func uidRange(from, n int) []int {
	out := make([]int, n)
	for i := range out {
		out[i] = from + i
	}
	return out
}

func TestCampusPeopleStatesLeaveOutStaffAndOptedOut(t *testing.T) {
	c := NewCampusCount([]string{"peer99"}, campusNow)
	var people []any
	people = append(people, many(900001, 6, "Cadet", "2024-09-02T08:00:00Z", "2027-01-01T00:00:00Z", true)...)       // active
	people = append(people, many(900011, 7, "Cadet", "2023-10-02T08:00:00Z", "2025-01-01T00:00:00Z", false)...)      // blackholed
	people = append(people, many(900021, 5, "Transcender", "2023-10-02T08:00:00Z", "2025-01-01T00:00:00Z", true)...) // transcended (past black hole doesn't count)
	people = append(people, cursusUser(900031, "peer31", "Alumni", "2022-10-03T08:00:00Z", "", false, false))
	people = append(people, cursusUser(900032, "staffer", "", "2022-10-03T08:00:00Z", "", true, true))
	people = append(people, cursusUser(900099, "peer99", "Cadet", "2024-09-02T08:00:00Z", "", true, false))
	people = append(people, cursusUser(900033, "3b3-12345", "Cadet", "2023-10-02T08:00:00Z", "2024-01-01T00:00:00Z", false, false))
	c.People(people)
	c.Attempts(handedIn(append(append(append(uidRange(900001, 6), uidRange(900011, 7)...), uidRange(900021, 5)...), 900031, 900032, 900099, 900033)...))
	out := campusResult(t, c)
	ps := out["people"].(map[string]any)
	if ps["total"] != 20.0 {
		t.Fatalf("total %v (staff and the opted-out student left out)", ps["total"])
	}
	st := ps["by_state"].(map[string]any)
	if st["active"] != 6.0 || st["blackholed"] != 8.0 || st["transcender"] != 5.0 || st["alumni"] != nil || st["inactive"] != 0.0 {
		t.Fatalf("states %v (one alumnus is under 5: null)", st)
	}
}

func TestCampusProjectOutcomesAndReasons(t *testing.T) {
	c := NewCampusCount(nil, campusNow)
	c.People(many(900001, 10, "Cadet", "2024-09-02T08:00:00Z", "2027-01-01T00:00:00Z", true))
	c.People(many(900011, 6, "Cadet", "2024-09-02T08:00:00Z", "2025-06-01T00:00:00Z", false))
	var pus []any
	team := 1
	add := func(uid int, status string, validated any, teams ...tm) {
		pus = append(pus, projectUser(800000+len(pus), uid, "42cursus-minishell", status, validated, nil, "2025-01-01T00:00:00Z", "2025-01-11T00:00:00Z", teams...))
	}
	next := func(mark any, validated any, status string) tm {
		team++
		return tm{team, mark, validated, status, fmt.Sprintf("2025-01-%02dT00:00:00Z", team%28+1)}
	}
	// 5 passed on the first try, with a bonus
	for i := range 5 {
		add(900001+i, "finished", true, next(110.0, true, "finished"))
	}
	norme := next(0.0, false, "finished")
	cheat := next(-42.0, false, "finished")
	low := next(30.0, false, "finished")
	auto := next(0.0, false, "finished")
	silent := next(0.0, false, "finished")
	// 5 failed: Norme, cheat (-42), evaluation marks under 50, automatic grading (evaluations fine), no evaluation at all
	add(900006, "finished", false, norme)
	add(900007, "finished", false, cheat)
	add(900008, "finished", false, low)
	add(900009, "finished", false, auto)
	add(900010, "finished", false, silent)
	// 5 blackholed with the project open: lost to the black hole
	for i := range 5 {
		add(900011+i, "in_progress", nil, next(nil, nil, "in_progress"))
	}
	add(900016, "in_progress", nil, next(nil, nil, "in_progress")) // a sixth, so the count is not under 5 by accident
	// an attempt of another cursus (the Piscine: the API's cursus filter lets it through) is left out
	piscine := projectUser(899998, 900001, "42cursus-minishell", "in_progress", nil, nil, "2025-01-01T00:00:00Z", "", tm{998, nil, nil, "in_progress", "2025-01-01T00:00:00Z"}).(map[string]any)
	piscine["cursus_ids"] = []any{9.0}
	pus = append(pus, piscine)
	pus = append(pus, handedIn(uidRange(900011, 6)...)...) // the ones the black hole caught had handed Libft in
	// someone the count doesn't know (staff, Piscine…) is left out
	pus = append(pus, projectUser(899999, 777777, "42cursus-minishell", "finished", true, 100.0, "2025-01-01T00:00:00Z", "2025-01-02T00:00:00Z", tm{999, 100.0, true, "finished", "2025-01-01T00:00:00Z"}))
	c.Attempts(pus)
	c.Evaluations([]any{
		evaluation(norme.id, "Norme", false, 80.0), evaluation(norme.id, "Ok", true, 90.0),
		evaluation(cheat.id, "Ok", true, 90.0),
		evaluation(low.id, "Ok", true, 30.0),
		evaluation(auto.id, "Ok", true, 100.0), evaluation(auto.id, "Outstanding project", true, 100.0),
	})
	out := campusResult(t, c)
	p := projectRow(t, out, "42cursus-minishell")
	if p["milestone"] != "rank-03" || p["track"] != "c" || p["name"] != "Name of 42cursus-minishell" {
		t.Fatalf("row %v", p)
	}
	if p["registered"] != 16.0 || p["passed"] != 5.0 || p["failed"] != 5.0 || p["lost_blackhole"] != 6.0 || p["in_progress"] != 0.0 {
		t.Fatalf("outcomes %v", p)
	}
	if p["first_try"] != 5.0 || p["bonus"] != 5.0 || p["median_days"] != 10.0 || p["attempts"] != 16.0 {
		t.Fatalf("passes %v", p)
	}
	r := p["reasons"].(map[string]any)
	// one of each: every reason is under 5, so null; the reasons are still listed
	for _, k := range []string{"norme", "cheat", "eval_marks", "auto_grading", "no_evaluation"} {
		if v, ok := r[k]; !ok || v != nil {
			t.Fatalf("reason %s = %v in %v", k, v, r)
		}
	}
	if r["leaks"] != 0.0 {
		t.Fatalf("a reason nobody had is 0, not null: %v", r)
	}
}

func TestCampusReasonsCountedWhenFiveOrMore(t *testing.T) {
	c := NewCampusCount(nil, campusNow)
	c.People(many(900001, 6, "Cadet", "2024-09-02T08:00:00Z", "2027-01-01T00:00:00Z", true))
	var pus []any
	var evs []any
	for i := range 6 {
		pus = append(pus, projectUser(800000+i, 900001+i, "exam-rank-02", "finished", false, 0.0, "2025-01-01T00:00:00Z", "",
			tm{100 + i, 0.0, false, "finished", "2025-01-01T00:00:00Z"}))
		pus = append(pus, projectUser(810000+i, 900001+i, "42cursus-libft", "finished", false, 0.0, "2025-01-01T00:00:00Z", "",
			tm{200 + i, 0.0, false, "finished", "2025-01-01T00:00:00Z"}))
		evs = append(evs, evaluation(200+i, "Can’t support / explain code", false, 0.0), evaluation(200+i, "Concerning situation", false, 0.0))
	}
	c.Attempts(pus)
	c.Evaluations(evs)
	out := campusResult(t, c)
	if r := projectRow(t, out, "exam-rank-02")["reasons"].(map[string]any); r["exam"] != 6.0 {
		t.Fatalf("exam reasons %v", r)
	}
	r := projectRow(t, out, "42cursus-libft")["reasons"].(map[string]any)
	if r["cant_explain"] != 6.0 || r["other_flag"] != 0.0 {
		t.Fatalf("libft reasons %v (the stronger flag wins; Concerning situation never on its own line)", r)
	}
	if _, ok := r["concerning_situation"]; ok {
		t.Fatal("Concerning situation has a line of its own")
	}
}

func TestCampusFunnelTracksAndBlackHole(t *testing.T) {
	c := NewCampusCount(nil, campusNow)
	c.People(many(900001, 5, "Cadet", "2024-09-02T08:00:00Z", "2025-06-01T00:00:00Z", false)) // C, blackholed on milestone 1
	c.People(many(900011, 5, "Cadet", "2025-03-03T08:00:00Z", "2027-06-01T00:00:00Z", true))  // Python, on milestone 2
	c.People(many(900021, 5, "Transcender", "2023-10-02T08:00:00Z", "", true))                // finished the Common Core
	pus := handedIn(uidRange(900021, 5)...)
	for i := range 5 {
		pus = append(pus, projectUser(700000+i, 900001+i, "42cursus-libft", "finished", true, 100.0, "2024-09-10T00:00:00Z", "2024-09-20T00:00:00Z", tm{300 + i, 100.0, true, "finished", "2024-09-10T00:00:00Z"}))
		pus = append(pus, projectUser(710000+i, 900001+i, "42cursus-get_next_line", "in_progress", nil, nil, "2024-10-01T00:00:00Z", "", tm{400 + i, nil, nil, "in_progress", "2024-10-01T00:00:00Z"}))
		pus = append(pus, projectUser(720000+i, 900011+i, "42cursus-libft", "finished", true, 100.0, "2025-03-10T00:00:00Z", "2025-03-20T00:00:00Z", tm{500 + i, 100.0, true, "finished", "2025-03-10T00:00:00Z"}))
		pus = append(pus, projectUser(730000+i, 900011+i, "42next-push_swap", "finished", true, 100.0, "2025-04-01T00:00:00Z", "2025-04-20T00:00:00Z", tm{600 + i, 100.0, true, "finished", "2025-04-01T00:00:00Z"}))
	}
	c.Attempts(pus)
	out := campusResult(t, c)
	f := out["funnel"].(map[string]any)
	cf, pf := f["c"].(map[string]any), f["python"].(map[string]any)
	if cf["people"] != 10.0 || pf["people"] != 5.0 {
		t.Fatalf("people per track %v (Transcenders with no project here count on the C track)", f)
	}
	if fmt.Sprint(cf["reached"]) != "[10 5 5 5 5 5 5]" || fmt.Sprint(pf["reached"]) != "[5 5 0 0 0 0 0]" {
		t.Fatalf("reached c %v python %v", cf["reached"], pf["reached"])
	}
	bh := out["blackhole"].(map[string]any)
	if bh["by_milestone"].(map[string]any)["rank-01"] != 5.0 {
		t.Fatalf("black hole by milestone %v", bh)
	}
	lost := bh["lost_on"].([]any)
	if len(lost) != 1 || lost[0].(map[string]any)["slug"] != "42cursus-get_next_line" || lost[0].(map[string]any)["people"] != 5.0 {
		t.Fatalf("lost on %v", lost)
	}
	if p := projectRow(t, out, "42next-push_swap"); p["track"] != "python" || p["milestone"] != "rank-01" {
		t.Fatalf("python row %v", p)
	}
	coh := out["cohorts"].([]any)
	if len(coh) != 3 || coh[0].(map[string]any)["cohort"] != "2023-10" {
		t.Fatalf("cohorts %v", coh)
	}
}

func TestPythonSlugsComeFromTracks(t *testing.T) {
	for _, s := range []string{"python-module-00", "42next-push_swap", "a-maze-ing", "pac-man", "agent-smith"} {
		if !PythonSlug(s) {
			t.Fatalf("%s is the Python track's", s)
		}
	}
	for _, s := range []string{"42cursus-libft", "cub3d", "exam-rank-04", "ft_transcendence"} {
		if PythonSlug(s) {
			t.Fatalf("%s is the C track's", s)
		}
	}
}

// The Piscine: everyone who did the C Piscine in Madrid, admitted to the 42cursus or not (owner, 2026-11-25), by Piscine
// month; each day, rush and exam with its outcome and why attempts failed; only totals, null under 5.
func TestPiscineCountCandidatesAdmittedAndProjects(t *testing.T) {
	c := NewPiscineCount([]string{"peer99"}, campusNow)
	var people []any
	for i := range 12 {
		people = append(people, cursusUser(900001+i, fmt.Sprintf("peer%02d", i+1), "", "2024-07-01T08:00:00Z", "", false, false))
	}
	people = append(people, cursusUser(900099, "peer99", "", "2024-07-01T08:00:00Z", "", false, false), cursusUser(900098, "staffer", "", "2024-07-01T08:00:00Z", "", true, true))
	c.People(people)
	admitted := map[int]bool{}
	for i := range 6 {
		admitted[900001+i] = true
	}
	var pus, evs []any
	for i := range 12 {
		uid := 900001 + i
		ok := i < 7
		pu := projectUser(600000+i, uid, "c-piscine-c-05", "finished", ok, nil, "2024-07-08T00:00:00Z", "2024-07-09T00:00:00Z", tm{700 + i, map[bool]any{true: 80.0, false: 0.0}[ok], ok, "finished", "2024-07-08T00:00:00Z"}).(map[string]any)
		pu["cursus_ids"] = []any{9.0}
		pus = append(pus, pu)
		if !ok {
			evs = append(evs, evaluation(700+i, "Ok", true, 100.0)) // fine evaluations, still failed: the moulinette
		}
	}
	other := projectUser(610000, 900001, "42cursus-libft", "finished", true, 100.0, "2024-09-08T00:00:00Z", "", tm{799, 100.0, true, "finished", "2024-09-08T00:00:00Z"})
	pus = append(pus, other) // a 42cursus attempt is not the Piscine's
	c.Attempts(pus)
	c.Evaluations(evs)
	raw, _ := json.Marshal(c.Result(admitted))
	var out map[string]any
	json.Unmarshal(raw, &out)
	ps := out["people"].(map[string]any)
	if ps["total"] != 12.0 || ps["admitted"] != 6.0 || ps["not_admitted"] != 6.0 {
		t.Fatalf("people %v (staff and the opted-out student left out)", ps)
	}
	if pis := out["piscines"].([]any); len(pis) != 1 || pis[0].(map[string]any)["cohort"] != "2024-07" || pis[0].(map[string]any)["admitted"] != 6.0 {
		t.Fatalf("piscines %v", pis)
	}
	rows := out["projects"].([]any)
	if len(rows) != 1 {
		t.Fatalf("projects %v (the 42cursus attempt left out)", rows)
	}
	p := rows[0].(map[string]any)
	if p["slug"] != "c-piscine-c-05" || p["registered"] != 12.0 || p["passed"] != 7.0 || p["failed"] != 5.0 || p["passed_admitted"] != 6.0 {
		t.Fatalf("row %v", p)
	}
	if r := p["reasons"].(map[string]any); r["auto_grading"] != 5.0 {
		t.Fatalf("reasons %v", r)
	}
}

// A count moved from make dev to production (Server stats' import) must be a count: its shape, and nothing about anyone.
func TestCheckCampusStats(t *testing.T) {
	ok := `{"generated_at":"2026-11-25T17:00:00Z","requests":10,"seconds":60,"people":{"total":10},"funnel":{},"projects":[{"slug":"42cursus-libft","name":"Libft"}],"piscine":{"people":{"total":5},"projects":[]}}`
	if err := CheckCampusStats([]byte(ok)); err != nil {
		t.Fatalf("a count refused: %v", err)
	}
	for name, bad := range map[string]string{
		"not json":    `{"generated_at"`,
		"no date":     `{"people":{"total":1},"funnel":{},"projects":[]}`,
		"no projects": `{"generated_at":"2026-11-25T17:00:00Z","people":{"total":1},"funnel":{}}`,
		"a person":    `{"generated_at":"2026-11-25T17:00:00Z","people":{"total":1},"funnel":{},"projects":[{"slug":"x","login":"peer01"}]}`,
		"an email":    `{"generated_at":"2026-11-25T17:00:00Z","people":{"total":1},"funnel":{},"projects":[],"piscine":{"x":[{"email":"a@example.invalid"}]}}`,
		"a report":    `{"generated_at":"2026-11-25T17:00:00Z","people":{"total":1},"funnel":{},"projects":[],"periods":{}}`,
	} {
		if CheckCampusStats([]byte(bad)) == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

// Whoever never handed anything in (no attempt closed: not even Libft; in the Piscine, no Shell, day, rush or exam) is
// not counted anywhere (owner, 2026-11-25); the count says how many were left out.
func TestCampusLeavesOutWhoeverHandedNothingIn(t *testing.T) {
	c := NewCampusCount(nil, campusNow)
	c.People(many(900001, 6, "Cadet", "2024-09-02T08:00:00Z", "2027-01-01T00:00:00Z", true))
	c.People(many(900011, 5, "Cadet", "2024-09-02T08:00:00Z", "2025-01-01T00:00:00Z", false)) // admitted, then nothing
	var pus []any
	for i := range 6 {
		pus = append(pus, projectUser(500000+i, 900001+i, "42cursus-libft", "finished", true, 100.0, "2024-09-10T00:00:00Z", "2024-09-20T00:00:00Z", tm{100 + i, 100.0, true, "finished", "2024-09-10T00:00:00Z"}))
	}
	for i := range 5 { // registered for Libft, never closed it
		pus = append(pus, projectUser(510000+i, 900011+i, "42cursus-libft", "in_progress", nil, nil, "2024-09-10T00:00:00Z", "", tm{200 + i, nil, nil, "in_progress", "2024-09-10T00:00:00Z"}))
	}
	c.Attempts(pus)
	out := campusResult(t, c)
	ps := out["people"].(map[string]any)
	if ps["total"] != 6.0 || ps["excluded"] != 5.0 || ps["by_state"].(map[string]any)["blackholed"] != 0.0 {
		t.Fatalf("people %v", ps)
	}
	if p := projectRow(t, out, "42cursus-libft"); p["registered"] != 6.0 || p["lost_blackhole"] != 0.0 {
		t.Fatalf("libft %v", p)
	}
	pc := NewPiscineCount(nil, campusNow)
	var cand []any
	for i := range 10 {
		cand = append(cand, cursusUser(900101+i, fmt.Sprintf("peer%02d", 30+i), "", "2024-07-01T08:00:00Z", "", false, false))
	}
	pc.People(cand)
	var ppus []any
	for i := range 10 {
		closed := i < 5
		st, team := "finished", tm{300 + i, 0.0, false, "finished", "2024-07-01T00:00:00Z"}
		if !closed {
			st, team = "in_progress", tm{300 + i, nil, nil, "in_progress", "2024-07-01T00:00:00Z"}
		}
		pu := projectUser(520000+i, 900101+i, "c-piscine-shell-00", st, map[bool]any{true: false, false: nil}[closed], nil, "2024-07-01T00:00:00Z", "", team).(map[string]any)
		pu["cursus_ids"] = []any{9.0}
		ppus = append(ppus, pu)
	}
	pc.Attempts(ppus)
	raw, _ := json.Marshal(pc.Result(nil))
	var pout map[string]any
	json.Unmarshal(raw, &pout)
	if pp := pout["people"].(map[string]any); pp["total"] != 5.0 || pp["excluded"] != 5.0 {
		t.Fatalf("piscine people %v", pp)
	}
}

// Outstandings ride on the evaluations the count already reads (no request more): how many a project's evaluations gave,
// how many passed it with three or more on the attempt that passed, and how many attempts failed in all.
func TestCampusOutstandingsAndFailedAttempts(t *testing.T) {
	c := NewCampusCount(nil, campusNow)
	c.People(many(900001, 6, "Cadet", "2024-09-02T08:00:00Z", "2027-01-01T00:00:00Z", true))
	var pus, evs []any
	for i := range 6 {
		pus = append(pus, projectUser(820000+i, 900001+i, "42cursus-ft_printf", "finished", true, 125.0, "2025-01-01T00:00:00Z", "2025-02-01T00:00:00Z",
			tm{400 + i, 40.0, false, "finished", "2025-01-01T00:00:00Z"}, tm{300 + i, 125.0, true, "finished", "2025-01-10T00:00:00Z"}))
		outs := 3
		if i == 5 {
			outs = 1
		}
		for range outs {
			evs = append(evs, evaluation(300+i, "Outstanding project", true, 125.0))
		}
		evs = append(evs, evaluation(400+i, "Ok", true, 40.0))
	}
	c.Attempts(pus)
	c.Evaluations(evs)
	row := projectRow(t, campusResult(t, c), "42cursus-ft_printf")
	if row["outstanding"] != 16.0 || row["outstanding_3"] != 5.0 || row["failed_attempts"] != 6.0 {
		t.Fatalf("outstanding %v, passed with 3 %v, failed attempts %v", row["outstanding"], row["outstanding_3"], row["failed_attempts"])
	}
}

// An attempt still open counts by who has it: on it while they are a student or a transcender with an active account,
// lost to the black hole, else left unfinished (alumni, frozen or gone; owner, 2026-11-26: transcenders doing their
// work experience were "abandoned").
func TestCampusOpenAttemptByWhoHasIt(t *testing.T) {
	c := NewCampusCount(nil, campusNow)
	var people []any
	people = append(people, many(900001, 5, "", "2024-09-01T08:00:00Z", "", true)...)                     // students
	people = append(people, many(900011, 5, "Transcender", "2023-09-01T08:00:00Z", "", true)...)          // transcenders
	people = append(people, many(900021, 5, "Transcender", "2023-09-01T08:00:00Z", "", false)...)         // transcenders, account closed
	people = append(people, many(900031, 5, "Alumni", "2021-09-01T08:00:00Z", "", true)...)               // alumni
	people = append(people, many(900041, 5, "", "2024-09-01T08:00:00Z", "", false)...)                    // frozen or gone
	people = append(people, many(900051, 5, "", "2023-09-01T08:00:00Z", "2025-01-01T00:00:00Z", true)...) // black hole
	c.People(people)
	var pus []any
	for _, from := range []int{900001, 900011, 900021, 900031, 900041, 900051} {
		pus = append(pus, handedIn(uidRange(from, 5)...)...)
		for _, uid := range uidRange(from, 5) {
			pus = append(pus, projectUser(500000+uid-900000, uid, "work-experience-ii", "in_progress", nil, nil, "2026-06-01T00:00:00Z", "", tm{2000000 + uid, nil, nil, "in_progress", "2026-06-01T00:00:00Z"}))
		}
	}
	c.Attempts(pus)
	p := projectRow(t, campusResult(t, c), "work-experience-ii")
	if p["registered"] != 30.0 || p["in_progress"] != 10.0 || p["abandoned"] != 15.0 || p["lost_blackhole"] != 5.0 || p["failed"] != 0.0 {
		t.Fatalf("row %v", p)
	}
}

// A project 1 to 4 people signed up for names their logins and keeps its exact figures (owner, 2026-11-26; privacy policy
// v8: how each did can be told, as on the intra); an erased account's anonymous login is left out; from 5 people on,
// figures under 5 hidden and no names.
func TestCampusFewNamesWhoSignedUp(t *testing.T) {
	c := NewCampusCount(nil, campusNow)
	people := many(900001, 6, "Transcender", "2023-09-01T08:00:00Z", "", true)
	people = append(people, cursusUser(900007, "3b3-a1b2c3", "Transcender", "2023-09-01T08:00:00Z", "", true, false))
	c.People(people)
	pus := handedIn(uidRange(900001, 7)...)
	for _, uid := range []int{900003, 900001, 900007} {
		pus = append(pus, projectUser(510000+uid-900000, uid, "b", "finished", true, 100.0, "2026-01-01T00:00:00Z", "2026-02-01T00:00:00Z", tm{3000000 + uid, 100.0, true, "finished", "2026-01-01T00:00:00Z"}))
	}
	c.Attempts(pus)
	out := campusResult(t, c)
	b := projectRow(t, out, "b")
	if b["registered"] != 3.0 || b["passed"] != 3.0 || b["first_try"] != 3.0 || b["failed"] != 0.0 || fmt.Sprint(b["logins"]) != "[peer01 peer03]" {
		t.Fatalf("row %v", b)
	}
	if libft := projectRow(t, out, "42cursus-libft"); libft["logins"] != nil {
		t.Fatalf("names on a project of 7: %v", libft["logins"])
	}
	raw, _ := json.Marshal(c.Result())
	if err := CheckCampusStats([]byte(`{"generated_at":"2026-11-25T17:00:00Z","people":{},"funnel":{},"projects":` + string(asJSON(out["projects"])) + `}`)); err != nil {
		t.Fatalf("its own count refused: %v (%d bytes)", err, len(raw))
	}
}

func asJSON(v any) []byte { b, _ := json.Marshal(v); return b }

// A Piscine's attempt still open once that Piscine is over was left unfinished; open during it, it is under way.
func TestPiscineOpenAttemptAfterItEnded(t *testing.T) {
	c := NewPiscineCount(nil, campusNow)
	var people, pus []any
	for i := range 10 {
		uid := 900001 + i
		cu := cursusUser(uid, fmt.Sprintf("peer%02d", i+1), "", "2026-11-02T08:00:00Z", "", true, false).(map[string]any)
		cu["end_at"] = map[bool]string{true: "2024-07-26T00:00:00Z", false: "2026-11-27T00:00:00Z"}[i < 5]
		people = append(people, cu)
		for _, pu := range []any{
			projectUser(620000+i, uid, "c-piscine-shell-00", "finished", true, 100.0, "2026-11-02T00:00:00Z", "", tm{800 + i, 100.0, true, "finished", "2026-11-02T00:00:00Z"}),
			projectUser(630000+i, uid, "c-piscine-c-07", "in_progress", nil, nil, "2026-11-20T00:00:00Z", "", tm{900 + i, nil, nil, "in_progress", "2026-11-20T00:00:00Z"}),
		} {
			pu.(map[string]any)["cursus_ids"] = []any{9.0}
			pus = append(pus, pu)
		}
	}
	c.People(people)
	c.Attempts(pus)
	raw, _ := json.Marshal(c.Result(map[int]bool{}))
	var out map[string]any
	json.Unmarshal(raw, &out)
	for _, r := range out["projects"].([]any) {
		if p := r.(map[string]any); p["slug"] == "c-piscine-c-07" && (p["in_progress"] != 5.0 || p["abandoned"] != 5.0) {
			t.Fatalf("row %v", p)
		}
	}
}

// Logins only where a count may hold them: a project row of 1 to 4 people, at most 4, each a login.
func TestCheckCampusStatsLogins(t *testing.T) {
	count := func(rows string) []byte {
		return []byte(`{"generated_at":"2026-11-25T17:00:00Z","people":{"total":10},"funnel":{},"projects":[` + rows + `]}`)
	}
	for _, ok := range []string{`{"slug":"b","registered":3,"passed":1,"logins":["peer01","peer-02"]}`, `{"slug":"b","registered":null,"logins":["peer01"]}`} {
		if err := CheckCampusStats(count(ok)); err != nil {
			t.Fatalf("refused %s: %v", ok, err)
		}
	}
	for name, rows := range map[string]string{
		"five or more": `{"slug":"b","registered":7,"logins":["peer01"]}`,
		"nobody":       `{"slug":"b","registered":0,"logins":["peer01"]}`,
		"five logins":  `{"slug":"b","registered":null,"logins":["a","b","c","d","e"]}`,
		"not a login":  `{"slug":"b","registered":null,"logins":["Peer One <a@example.invalid>"]}`,
		"not a list":   `{"slug":"b","registered":null,"logins":"peer01"}`,
		"out of a row": `{"slug":"b","registered":null,"reasons":{"logins":["peer01"]}}`,
	} {
		if CheckCampusStats(count(rows)) == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

// Whoever asks to be excluded after a count goes from its names at once (the server drops them when it loads or keeps one).
func TestDropLoginsOfTheOptedOut(t *testing.T) {
	in := []byte(`{"generated_at":"2026-11-25T17:00:00Z","projects":[{"slug":"b","registered":null,"logins":["peer01","peer02"]},{"slug":"c","registered":null,"logins":["peer02"]}]}`)
	out := string(DropLogins(in, []string{"Peer02"}))
	if out != `{"generated_at":"2026-11-25T17:00:00Z","projects":[{"logins":["peer01"],"registered":null,"slug":"b"},{"registered":null,"slug":"c"}]}` {
		t.Fatalf("%s", out)
	}
	if got := DropLogins(in, nil); string(got) != string(in) {
		t.Fatalf("changed with nobody to drop: %s", got)
	}
}

// Closed without a mark (validated? and the mark both empty, as a work experience's peer video the intra never grades) is
// neither passed nor failed, nor a failed attempt; closed with a mark that didn't pass is a fail.
func TestCampusClosedWithoutAMarkIsNotAFail(t *testing.T) {
	c := NewCampusCount(nil, campusNow)
	c.People(many(900001, 10, "Transcender", "2023-09-01T08:00:00Z", "", true))
	pus := handedIn(uidRange(900001, 10)...)
	for i, uid := range uidRange(900001, 10) {
		v, mark := any(nil), any(nil)
		if i >= 5 {
			v, mark = false, 0.0
		}
		pus = append(pus, projectUser(520000+i, uid, "work-experience-ii-work-experience-ii-peer-video", "finished", v, mark, "2026-06-01T00:00:00Z", "", tm{4000000 + uid, mark, v, "finished", "2026-06-01T00:00:00Z"}))
	}
	c.Attempts(pus)
	p := projectRow(t, campusResult(t, c), "work-experience-ii-work-experience-ii-peer-video")
	if p["registered"] != 10.0 || p["closed_unmarked"] != 5.0 || p["failed"] != 5.0 || p["failed_attempts"] != 5.0 || p["reasons"].(map[string]any)["no_evaluation"] != 5.0 {
		t.Fatalf("row %v", p)
	}
}

// Last week's campus (the Monday-to-Sunday week before the count, in Madrid) and the twelve weeks before it: evaluations
// by when they were filled in (an opted-out corrector or corrected left out), projects and exams by their last mark,
// black holes by their day; the same "fewer than 5" rule.
func TestCampusWeekAndWeeks(t *testing.T) {
	c := NewCampusCount([]string{"peer90"}, campusNow) // Wednesday 2026-11-25: last week is 2026-11-16 to 2026-11-22
	people := many(900001, 6, "", "2024-10-07T08:00:00Z", "", true)
	people = append(people, many(900010, 5, "", "2023-10-02T08:00:00Z", "2026-11-18T10:00:00Z", false)...) // black hole last week
	people = append(people, cursusUser(900090, "peer90", "", "2024-10-07T08:00:00Z", "", true, false))
	c.People(people)
	pus := handedIn(append(uidRange(900001, 6), uidRange(900010, 5)...)...)
	for i := range 5 { // passed last week, failed last week, an exam failed last week, passed three weeks before
		uid := 900001 + i
		pus = append(pus,
			projectUser(810000+i, uid, "ft_printf", "finished", true, 100.0, "2026-11-01T00:00:00Z", "2026-11-17T09:00:00Z", tm{820000 + i, 100.0, true, "finished", "2026-11-01T00:00:00Z"}),
			projectUser(830000+i, uid, "get_next_line", "finished", false, 20.0, "2026-11-01T00:00:00Z", "2026-11-22T22:00:00Z", tm{840000 + i, 20.0, false, "finished", "2026-11-01T00:00:00Z"}),
			projectUser(850000+i, uid, "exam-rank-02", "in_progress", false, 0.0, "2026-11-01T00:00:00Z", "2026-11-20T12:00:00Z", tm{860000 + i, 0.0, false, "finished", "2026-11-20T00:00:00Z"}),
			projectUser(870000+i, uid, "born2beroot", "finished", true, 100.0, "2026-10-20T00:00:00Z", "2026-11-04T10:00:00Z", tm{880000 + i, 100.0, true, "finished", "2026-10-20T00:00:00Z"}))
	}
	pus = append(pus, projectUser(890000, 900003, "push_swap", "finished", true, 100.0, "2026-11-01T00:00:00Z", "2026-11-23T00:30:00+01:00", tm{890001, 100.0, true, "finished", "2026-11-01T00:00:00Z"})) // this week: no
	c.Attempts(pus)
	ev := func(filled, flag string, positive bool, corrector string) any {
		e := evaluation(1, flag, positive, 100.0).(map[string]any)
		e["filled_at"], e["corrector"] = filled, map[string]any{"login": corrector}
		e["correcteds"] = []any{map[string]any{"login": "peer01"}}
		return e
	}
	var evs []any
	for range 12 {
		evs = append(evs, ev("2026-11-19T10:00:00Z", "Ok", true, "peer02"))
	}
	for range 5 {
		evs = append(evs, ev("2026-11-21T10:00:00Z", "Outstanding project", true, "peer03"), ev("2026-11-21T11:00:00Z", "Norme", false, "peer04"))
	}
	evs = append(evs, ev("2026-11-20T10:00:00Z", "Ok", true, "peer90")) // opted out: not counted
	for range 7 {
		evs = append(evs, ev("2026-09-01T10:00:00Z", "Ok", true, "peer02")) // the week of 2026-08-31, the twelfth back
	}
	evs = append(evs, ev("2026-08-30T10:00:00Z", "Ok", true, "peer02"), ev("2026-11-24T10:00:00Z", "Ok", true, "peer02")) // too old; this week
	c.Evaluations(evs)
	out := campusResult(t, c)
	w := out["week"].(map[string]any)
	want := map[string]any{"from": "2026-11-16", "to": "2026-11-22", "evaluations": 22.0, "students": 6.0, "per_student": 3.7, "outstanding": 5.0,
		"negative_flags": 5.0, "passed": 5.0, "failed": 5.0, "exams_passed": 0.0, "exams_failed": 5.0, "blackholed": 5.0}
	for k, v := range want {
		if w[k] != v {
			t.Errorf("week %s = %v, want %v", k, w[k], v)
		}
	}
	ws := out["weeks"].([]any)
	if len(ws) != 12 {
		t.Fatalf("%d weeks", len(ws))
	}
	first, last := ws[0].(map[string]any), ws[11].(map[string]any)
	if first["from"] != "2026-08-31" || first["evaluations"] != 7.0 || last["from"] != "2026-11-16" || last["evaluations"] != 22.0 || last["passed"] != 5.0 {
		t.Fatalf("weeks %v … %v", first, last)
	}
	if b2b := ws[9].(map[string]any); b2b["from"] != "2026-11-02" || b2b["passed"] != 5.0 {
		t.Fatalf("three weeks back %v", b2b)
	}
}

// A Piscine is everyone who ends it the same day: whoever joined a few days late is in it, under its first month, not in
// a Piscine of their own.
func TestPiscineLateJoinersStayInTheirPiscine(t *testing.T) {
	c := NewPiscineCount(nil, campusNow)
	var people, pus []any
	for i := range 6 {
		begin := "2026-10-26T08:00:00Z"
		if i >= 4 {
			begin = "2026-11-03T08:00:00Z"
		}
		cu := cursusUser(900001+i, fmt.Sprintf("peer%02d", i+1), "", begin, "", false, false).(map[string]any)
		cu["end_at"] = "2026-11-20T15:00:00Z"
		people = append(people, cu)
		pu := projectUser(600000+i, 900001+i, "c-piscine-c-00", "finished", true, 100.0, "2026-10-27T00:00:00Z", "2026-10-28T00:00:00Z", tm{700 + i, 100.0, true, "finished", "2026-10-27T00:00:00Z"}).(map[string]any)
		pu["cursus_ids"] = []any{9.0}
		pus = append(pus, pu)
	}
	c.People(people)
	c.Attempts(pus)
	raw, _ := json.Marshal(c.Result(nil))
	var out map[string]any
	json.Unmarshal(raw, &out)
	if pis := out["piscines"].([]any); len(pis) != 1 || pis[0].(map[string]any)["cohort"] != "2026-10" || pis[0].(map[string]any)["people"] != 6.0 {
		t.Fatalf("piscines %v", pis)
	}
}
