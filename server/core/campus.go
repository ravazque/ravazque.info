package core

import (
	"encoding/json"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"
)

// CampusCount folds the campus-wide lists (42cursus enrolments, project attempts, evaluations), page by page as they
// arrive, into anonymous totals per project and per cohort (spec: .development/superpowers/specs/2026-11-25-campus-stats-
// design.md). It holds ids and logins only while the count lasts; Result has no id or name of anyone, every figure that
// covers 1 to 4 people is null, but a project only 1 to 4 people signed up for names them by login and keeps its exact
// figures (owner, 2026-11-26; policy v8).
type CampusCount struct {
	campusFold
	now    time.Time
	optout map[string]bool
	people map[int]*campusPerson
	anchor time.Time          // this week's Monday, 00:00 in Madrid: the weeks counted end there
	weeks  [weeksBack]weekAcc // 0: last week, 11: twelve weeks back
}

// weeksBack: the weeks before the count's own that it adds up (last week, and the eleven before it, for the trend).
const weeksBack = 12

type weekAcc struct{ evals, out, flags, passed, failed, examsPassed, examsFailed, bh int }

// campusFold is what the 42cursus count and the Piscine's fold the same way: the attempts of one cursus and, per
// attempt (team), what its evaluations say.
type campusFold struct {
	mu       sync.Mutex
	cursus   int
	attempts []campusAttempt
	flags    map[int]campusEvals // team id → its evaluations, folded
}

type campusPerson struct {
	state, cohort, login, bh string // bh: blackholed_at
	erased, active           bool   // an erased account's anonymous login; the account still open
}

type campusTeam struct {
	id                        int
	mark                      *float64
	validated, open, unmarked bool // unmarked: validated? and the mark both empty
	created                   string
}

type campusAttempt struct {
	uid                       int
	slug, name                string
	open, validated, unmarked bool // unmarked: closed or not, validated? and the mark both empty
	created, marked           string
	teams                     []campusTeam
}

type campusEvals struct {
	any, low bool // has an evaluation; one marked under 50
	flag     int  // the strongest negative flag (index in reasonOrder), -1 none
	out      int  // its Outstanding flags
}

// One reason per failed attempt, the first that applies in this order.
var reasonOrder = []string{"cheat", "forbidden_function", "norme", "leaks", "crash", "invalid_compilation", "empty_work",
	"incomplete_work", "cant_explain", "other_flag", "exam", "eval_marks", "auto_grading", "no_evaluation"}

// flagReason: the negative flags by name; any other negative one (Concerning situation, a wellbeing flag, included)
// counts as other_flag.
var flagReason = map[string]string{"Cheat": "cheat", "Forbidden Function": "forbidden_function", "Norme": "norme",
	"Leaks": "leaks", "Crash": "crash", "Invalid compilation": "invalid_compilation", "Empty work": "empty_work",
	"Incomplete work": "incomplete_work", "Can’t support / explain code": "cant_explain", "Can't support / explain code": "cant_explain"}

var examSlug = regexp.MustCompile(`(^|-)exam(-|$)`)

// PythonSlug: the Python track (42Next) of the Common Core, same cursus as the C track (tracks.json "python").
func PythonSlug(slug string) bool { return pythonSlugs()[slug] }

var pythonSlugs = sync.OnceValue(func() map[string]bool {
	var f struct {
		Python []string `json:"python"`
	}
	raw, _ := Data.ReadFile("data/tracks.json")
	if err := json.Unmarshal(raw, &f); err != nil {
		panic(err)
	}
	out := map[string]bool{}
	for _, s := range f.Python {
		out[s] = true
	}
	return out
})

func NewCampusCount(optout []string, now time.Time) *CampusCount {
	c := &CampusCount{campusFold: campusFold{cursus: MainCursus, flags: map[int]campusEvals{}}, now: now, optout: map[string]bool{}, people: map[int]*campusPerson{}, anchor: weekStart(now)}
	for _, l := range optout {
		c.optout[strings.ToLower(l)] = true
	}
	return c
}

func intOf(v any) int { f, _ := v.(float64); return int(f) }

// People folds a page of /cursus/21/cursus_users: staff and opted-out students are left out.
func (c *CampusCount) People(batch []any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, x := range batch {
		cu, _ := x.(map[string]any)
		u := Obj(cu, "user")
		login := strings.ToLower(Str(u, "login"))
		if u == nil || Bool(u, "staff?") || c.optout[login] {
			continue
		}
		grade := Str(cu, "grade")
		bh := Str(cu, "blackholed_at")
		state := "active"
		switch {
		case grade == "Alumni" || Bool(u, "alumni?"):
			state = "alumni"
		case grade == "Transcender":
			state = "transcender"
		case bh != "" && TS(bh).Before(c.now):
			state = "blackholed"
		case !Bool(u, "active?"):
			state = "inactive"
		}
		cohort := Str(cu, "begin_at")
		if len(cohort) >= 7 {
			cohort = cohort[:7]
		}
		c.people[intOf(u["id"])] = &campusPerson{state, cohort, login, bh, strings.HasPrefix(login, "3b3-"), Bool(u, "active?")}
	}
}

// Attempts folds a page of /projects_users: one row per person and project, a team per attempt.
func (c *campusFold) Attempts(batch []any) {
	rows := make([]campusAttempt, 0, len(batch))
	for _, x := range batch {
		pu, _ := x.(map[string]any)
		// the API's cursus filter also lets through the same people's attempts of other cursus: only this one's
		if pu == nil || Str(pu, "status") == "parent" || !slices.Contains(List(pu, "cursus_ids"), any(float64(c.cursus))) {
			continue
		}
		p := Obj(pu, "project")
		a := campusAttempt{uid: intOf(Obj(pu, "user")["id"]), slug: Str(p, "slug"), name: Str(p, "name"),
			open: Str(pu, "status") != "finished", validated: pu["validated?"] == true, unmarked: pu["validated?"] == nil && pu["final_mark"] == nil,
			created: Str(pu, "created_at"), marked: Str(pu, "marked_at")}
		for _, t := range List(pu, "teams") {
			tr, _ := t.(map[string]any)
			ct := campusTeam{id: intOf(tr["id"]), validated: tr["validated?"] == true, open: Str(tr, "status") != "finished", created: Str(tr, "created_at"),
				unmarked: tr["validated?"] == nil && tr["final_mark"] == nil}
			if m, ok := tr["final_mark"].(float64); ok {
				ct.mark = &m
			}
			a.teams = append(a.teams, ct)
		}
		slices.SortFunc(a.teams, func(x, y campusTeam) int { return strings.Compare(x.created, y.created) })
		rows = append(rows, a)
	}
	c.mu.Lock()
	c.attempts = append(c.attempts, rows...)
	c.mu.Unlock()
}

// Evaluations folds a page of /scale_teams into what each attempt needs: the strongest negative flag and whether a mark
// was under 50.
func (c *campusFold) Evaluations(batch []any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, x := range batch {
		st, _ := x.(map[string]any)
		id := intOf(Obj(st, "team")["id"])
		if st == nil || id == 0 {
			continue
		}
		e, ok := c.flags[id]
		if !ok {
			e.flag = -1
		}
		e.any = true
		if m, ok := st["final_mark"].(float64); ok && m < 50 {
			e.low = true
		}
		if f := Obj(st, "flag"); f != nil && f["positive"] == true && Str(f, "name") == outstandingFlag {
			e.out++
		}
		if f := Obj(st, "flag"); f != nil && f["positive"] == false {
			r, known := flagReason[Str(f, "name")]
			if !known {
				r = "other_flag"
			}
			if i := slices.Index(reasonOrder, r); e.flag < 0 || i < e.flag {
				e.flag = i
			}
		}
		c.flags[id] = e
	}
}

// weekStart: the Monday of t's week, 00:00 in Madrid.
func weekStart(t time.Time) time.Time {
	m := t.In(Madrid)
	d := time.Date(m.Year(), m.Month(), m.Day(), 0, 0, 0, 0, Madrid)
	return d.AddDate(0, 0, -((int(d.Weekday()) + 6) % 7))
}

// weekOf: how many whole weeks before the count's own ts falls (0: last week), -1 outside the weeks counted.
func (c *CampusCount) weekOf(ts string) int {
	if ts == "" {
		return -1
	}
	t := TS(ts)
	for k := range weeksBack {
		if !t.Before(c.anchor.AddDate(0, 0, -7*(k+1))) && t.Before(c.anchor.AddDate(0, 0, -7*k)) {
			return k
		}
	}
	return -1
}

// Evaluations folds a page of the 42cursus' /scale_teams as campusFold does, and adds each one filled in during the
// weeks counted to its week (an opted-out corrector or corrected leaves it out).
func (c *CampusCount) Evaluations(batch []any) {
	c.campusFold.Evaluations(batch)
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, x := range batch {
		st, _ := x.(map[string]any)
		k := c.weekOf(Str(st, "filled_at"))
		if k < 0 || c.optout[strings.ToLower(Str(Obj(st, "corrector"), "login"))] || slices.ContainsFunc(List(st, "correcteds"), func(x any) bool {
			m, _ := x.(map[string]any)
			return c.optout[strings.ToLower(Str(m, "login"))]
		}) {
			continue
		}
		w := &c.weeks[k]
		w.evals++
		if f := Obj(st, "flag"); f != nil && f["positive"] == true && Str(f, "name") == outstandingFlag {
			w.out++
		} else if f != nil && f["positive"] == false {
			w.flags++
		}
	}
}

// failed: a closed attempt that didn't pass and has a result (closed with neither validated? nor a mark is no fail).
func (t campusTeam) failed() bool { return !t.open && !t.validated && !t.unmarked }

// handed: who closed at least one attempt (handed something in); the others count nowhere (owner, 2026-11-25).
func (c *campusFold) handed() map[int]bool {
	out := map[int]bool{}
	for _, a := range c.attempts {
		if slices.ContainsFunc(a.teams, func(t campusTeam) bool { return !t.open }) {
			out[a.uid] = true
		}
	}
	return out
}

func (c *campusFold) reason(slug string, t campusTeam) string {
	e, ok := c.flags[t.id]
	switch {
	case t.mark != nil && *t.mark < 0:
		return "cheat"
	case ok && e.flag >= 0:
		return reasonOrder[e.flag]
	case examSlug.MatchString(slug):
		return "exam"
	case ok && e.low:
		return "eval_marks"
	case ok:
		return "auto_grading" // inferred: every evaluation fine, the attempt still failed
	}
	return "no_evaluation"
}

// Admitted: the 42cursus students the count holds (in memory only), for the Piscine's count to tell who got in.
func (c *CampusCount) Admitted() map[int]bool {
	c.mu.Lock()
	defer c.mu.Unlock()
	out := make(map[int]bool, len(c.people))
	for uid := range c.people {
		out[uid] = true
	}
	return out
}

// kAnon: a count of 1 to 4 people is null; 0 stays 0.
func kAnon(n int) any {
	if n > 0 && n < 5 {
		return nil
	}
	return n
}

// campusMedian is null under 5 values (the same rule as the counts).
func campusMedian(xs []float64) any {
	if len(xs) < 5 {
		return nil
	}
	return pyRound(median(xs), 1)
}

var milestones = []string{"rank-00", "rank-01", "rank-02", "rank-03", "rank-04", "rank-05", "rank-06"}

type projectAcc struct {
	slug, name, milestone, track                                  string
	registered, passed, failed, lost, open, gone, attempts, first int
	unmarked                                                      int
	bonus, max, outstanding, out3, failedTeams                    int
	tries                                                         [4]int
	days, marks                                                   []float64
	reasons                                                       map[string]int
	logins                                                        []string
}

// Result is the count's anonymous totals.
func (c *CampusCount) Result() map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	ranks := trackRanks()
	handed := c.handed()
	highest, python, lostOn := map[int]int{}, map[int]bool{}, map[string]map[int]bool{}
	names := map[string]string{}
	projects := map[string]*projectAcc{}
	weeks := c.weeks // a copy: Result adds the attempts and black holes to it
	for _, a := range c.attempts {
		who := c.people[a.uid]
		if who == nil || !handed[a.uid] {
			continue
		}
		// its last mark's week: passed, or failed with a mark (exams apart)
		if k := c.weekOf(a.marked); k >= 0 && (a.validated || !a.unmarked) {
			w, exam := &weeks[k], examSlug.MatchString(a.slug)
			switch {
			case a.validated && exam:
				w.examsPassed++
			case a.validated:
				w.passed++
			case exam:
				w.examsFailed++
			default:
				w.failed++
			}
		}
		if PythonSlug(a.slug) {
			python[a.uid] = true
		}
		p := projects[a.slug]
		if p == nil {
			ms, ok := ranks[a.slug]
			track := "c"
			if PythonSlug(a.slug) {
				track = "python"
			} else if !ok {
				ms, track = "outer-core", "outer"
			}
			p = &projectAcc{slug: a.slug, name: a.name, milestone: ms, track: track, reasons: map[string]int{}}
			projects[a.slug] = p
		}
		names[a.slug] = a.name
		p.registered++
		if !who.erased {
			p.logins = append(p.logins, who.login)
		}
		p.attempts += len(a.teams)
		switch {
		case a.validated:
			p.passed++
			if i := slices.IndexFunc(a.teams, func(t campusTeam) bool { return t.validated }); i >= 0 {
				p.tries[min(i, 3)]++
				if i == 0 {
					p.first++
				}
				if c.flags[a.teams[i].id].out >= 3 {
					p.out3++
				}
				if m := a.teams[i].mark; m != nil {
					p.marks = append(p.marks, *m)
					if *m > 100 {
						p.bonus++
					}
					if *m >= 125 {
						p.max++
					}
				}
			}
			if a.created != "" && a.marked != "" {
				p.days = append(p.days, TS(a.marked).Sub(TS(a.created)).Hours()/24)
			}
			if r, ok := ranks[a.slug]; ok {
				if i := slices.Index(milestones, r); i >= 0 && (highest[a.uid] == 0 || i+1 > highest[a.uid]) {
					highest[a.uid] = i + 1 // 0: none validated
				}
			}
		case !a.open && a.unmarked:
			p.unmarked++ // closed without a mark: neither passed nor failed
		case !a.open:
			p.failed++
		case who.state == "blackholed":
			p.lost++
			if lostOn[a.slug] == nil {
				lostOn[a.slug] = map[int]bool{}
			}
			lostOn[a.slug][a.uid] = true
		case who.active && (who.state == "active" || who.state == "transcender"):
			p.open++ // a student, or a transcender on the Outer Core (their work experience too)
		default:
			p.gone++ // left unfinished: alumni, frozen, or the account closed
		}
		for _, t := range a.teams {
			p.outstanding += c.flags[t.id].out
			if t.failed() {
				p.reasons[c.reason(a.slug, t)]++
				p.failedTeams++
			}
		}
	}

	// people, cohorts, funnel and black hole
	states := []string{"active", "blackholed", "transcender", "alumni", "inactive"}
	byState, erased := map[string]int{}, 0
	cohorts := map[string]map[string]int{}
	funnel := map[string]*[8]int{"c": {}, "python": {}} // [0..6] reached, [7] people
	bhBy := map[string]int{}
	counted, students := 0, 0
	for uid, who := range c.people {
		if !handed[uid] {
			continue
		}
		counted++
		if who.active && (who.state == "active" || who.state == "transcender") {
			students++
		}
		if k := c.weekOf(who.bh); k >= 0 && who.state == "blackholed" {
			weeks[k].bh++
		}
		byState[who.state]++
		if who.erased {
			erased++
		}
		if cohorts[who.cohort] == nil {
			cohorts[who.cohort] = map[string]int{}
		}
		cohorts[who.cohort]["people"]++
		cohorts[who.cohort][who.state]++
		track := "c"
		if python[uid] {
			track = "python"
		}
		h := highest[uid]
		if who.state == "transcender" || who.state == "alumni" {
			h = len(milestones)
		}
		f := funnel[track]
		f[7]++
		for k := range h {
			f[k]++
		}
		if who.state == "blackholed" {
			bhBy[milestones[min(h, len(milestones)-1)]]++
		}
	}
	stateOut := map[string]any{}
	for _, s := range states {
		stateOut[s] = kAnon(byState[s])
	}
	var cohortOut []any
	for _, k := range slices.Sorted(func(yield func(string) bool) {
		for k := range cohorts {
			if !yield(k) {
				return
			}
		}
	}) {
		row := map[string]any{"cohort": k, "people": kAnon(cohorts[k]["people"])}
		for _, s := range states {
			row[s] = kAnon(cohorts[k][s])
		}
		cohortOut = append(cohortOut, row)
	}
	funnelOut := map[string]any{}
	for t, f := range funnel {
		reached := make([]any, len(milestones))
		for k := range milestones {
			reached[k] = kAnon(f[k])
		}
		funnelOut[t] = map[string]any{"people": kAnon(f[7]), "reached": reached}
	}
	bhOut := map[string]any{}
	for _, m := range milestones {
		bhOut[m] = kAnon(bhBy[m])
	}
	var lost []any
	for slug, who := range lostOn {
		if len(who) >= 5 {
			lost = append(lost, map[string]any{"slug": slug, "name": names[slug], "people": len(who)})
		}
	}
	slices.SortFunc(lost, func(a, b any) int { return b.(map[string]any)["people"].(int) - a.(map[string]any)["people"].(int) })

	order := append(slices.Clone(milestones), "outer-core")
	var rows []*projectAcc
	for _, p := range projects {
		rows = append(rows, p)
	}
	slices.SortFunc(rows, func(a, b *projectAcc) int {
		if d := slices.Index(order, a.milestone) - slices.Index(order, b.milestone); d != 0 {
			return d
		}
		if a.registered != b.registered {
			return b.registered - a.registered
		}
		return strings.Compare(a.slug, b.slug)
	})
	var projOut []any
	for _, p := range rows {
		// a project 1 to 4 people signed up for names them and keeps its figures as they are (owner, 2026-11-26; policy v8)
		few := p.registered > 0 && p.registered < 5
		cnt, med := kAnon, campusMedian
		if few {
			cnt = func(n int) any { return n }
			med = func(xs []float64) any {
				if len(xs) == 0 {
					return nil
				}
				return pyRound(median(xs), 1)
			}
		}
		reasons := map[string]any{}
		for _, r := range reasonOrder {
			reasons[r] = cnt(p.reasons[r])
		}
		tries := make([]any, 4)
		for i, n := range p.tries {
			tries[i] = cnt(n)
		}
		row := map[string]any{"slug": p.slug, "name": p.name, "milestone": p.milestone, "track": p.track,
			"registered": cnt(p.registered), "passed": cnt(p.passed), "failed": cnt(p.failed), "lost_blackhole": cnt(p.lost),
			"in_progress": cnt(p.open), "abandoned": cnt(p.gone), "closed_unmarked": cnt(p.unmarked), "attempts": cnt(p.attempts),
			"first_try": cnt(p.first), "tries": tries, "median_days": med(p.days), "median_mark": med(p.marks), "bonus": cnt(p.bonus), "max": cnt(p.max),
			"outstanding": cnt(p.outstanding), "outstanding_3": cnt(p.out3), "failed_attempts": cnt(p.failedTeams),
			"reasons": reasons}
		if few && len(p.logins) > 0 {
			row["logins"] = slices.Sorted(slices.Values(p.logins))
		}
		projOut = append(projOut, row)
	}
	day := func(t time.Time) string { return t.Format("2006-01-02") }
	var weeksOut []any
	for k := weeksBack - 1; k >= 0; k-- {
		w := weeks[k]
		weeksOut = append(weeksOut, map[string]any{"from": day(c.anchor.AddDate(0, 0, -7*(k+1))), "evaluations": kAnon(w.evals), "passed": kAnon(w.passed), "failed": kAnon(w.failed)})
	}
	last := weeks[0]
	var perStudent any // evaluations per student, null when either count is under 5
	if students >= 5 && (last.evals == 0 || last.evals >= 5) {
		perStudent = pyRound(float64(last.evals)/float64(students), 1)
	}
	week := map[string]any{"from": day(c.anchor.AddDate(0, 0, -7)), "to": day(c.anchor.AddDate(0, 0, -1)), "evaluations": kAnon(last.evals),
		"students": kAnon(students), "per_student": perStudent, "outstanding": kAnon(last.out), "negative_flags": kAnon(last.flags),
		"passed": kAnon(last.passed), "failed": kAnon(last.failed), "exams_passed": kAnon(last.examsPassed), "exams_failed": kAnon(last.examsFailed), "blackholed": kAnon(last.bh)}
	return map[string]any{
		"week":      week,
		"weeks":     weeksOut,
		"people":    map[string]any{"total": kAnon(counted), "by_state": stateOut, "erased": kAnon(erased), "excluded": kAnon(len(c.people) - counted)},
		"cohorts":   cohortOut,
		"funnel":    funnelOut,
		"blackhole": map[string]any{"by_milestone": bhOut, "lost_on": lost},
		"projects":  projOut,
		"reasons":   reasonOrder,
	}
}
