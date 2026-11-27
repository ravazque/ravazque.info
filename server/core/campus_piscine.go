package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
)

// PiscineCount folds the C Piscine of 42 Madrid (everyone who did it, admitted to the 42cursus or not: owner, 2026-11-25)
// into anonymous totals per Piscine month and per day, rush and exam; the same rules as CampusCount (null under 5, no id
// kept once the count ends).
type PiscineCount struct {
	campusFold
	now    time.Time
	optout map[string]bool
	people map[int]pisciner
	ended  map[int]bool // user id → their Piscine is over
}

// pisciner: the month someone began the Piscine and the day it ends for them (everyone of one Piscine ends it together).
type pisciner struct{ month, end string }

func NewPiscineCount(optout []string, now time.Time) *PiscineCount {
	c := &PiscineCount{campusFold: campusFold{cursus: PiscineCursus, flags: map[int]campusEvals{}}, now: now, optout: map[string]bool{}, people: map[int]pisciner{}, ended: map[int]bool{}}
	for _, l := range optout {
		c.optout[strings.ToLower(l)] = true
	}
	return c
}

// People folds a page of /cursus/9/cursus_users: staff and opted-out students are left out.
func (c *PiscineCount) People(batch []any) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, x := range batch {
		cu, _ := x.(map[string]any)
		u := Obj(cu, "user")
		if u == nil || Bool(u, "staff?") || c.optout[strings.ToLower(Str(u, "login"))] {
			continue
		}
		if e := Str(cu, "end_at"); e != "" && TS(e).Before(c.now) {
			c.ended[intOf(u["id"])] = true
		}
		month, end := Str(cu, "begin_at"), Str(cu, "end_at")
		if len(month) >= 7 {
			month = month[:7]
		}
		if len(end) >= 10 {
			end = end[:10]
		}
		c.people[intOf(u["id"])] = pisciner{month, end}
	}
}

// Result: candidates and how many got in, per Piscine, and every project of the Piscine; admitted holds the 42cursus
// students (CampusCount.Admitted).
func (c *PiscineCount) Result(admitted map[int]bool) map[string]any {
	c.mu.Lock()
	defer c.mu.Unlock()
	in, months, handed, counted := 0, map[string][2]int{}, c.handed(), 0
	// a Piscine goes by its first month: whoever joined it late ends it the same day (2026-11-26: Oct 26 and Nov 3, both Nov 20)
	first := map[string]string{}
	for _, p := range c.people {
		if f, ok := first[p.end]; p.end != "" && (!ok || p.month < f) {
			first[p.end] = p.month
		}
	}
	for uid, p := range c.people {
		if !handed[uid] {
			continue
		}
		m := p.month
		if f, ok := first[p.end]; ok {
			m = f
		}
		counted++
		v := months[m]
		v[0]++
		if admitted[uid] {
			v[1]++
			in++
		}
		months[m] = v
	}
	var piscines []any
	for _, m := range slices.Sorted(func(yield func(string) bool) {
		for m := range months {
			if !yield(m) {
				return
			}
		}
	}) {
		piscines = append(piscines, map[string]any{"cohort": m, "people": kAnon(months[m][0]), "admitted": kAnon(months[m][1])})
	}
	type acc struct {
		name                                                                    string
		registered, passed, failed, open, gone, unmarked, attempts, first, inOf int
		marks                                                                   []float64
		reasons                                                                 map[string]int
	}
	rows := map[string]*acc{}
	for _, a := range c.attempts {
		if _, ok := c.people[a.uid]; !ok || !handed[a.uid] {
			continue
		}
		p := rows[a.slug]
		if p == nil {
			p = &acc{name: a.name, reasons: map[string]int{}}
			rows[a.slug] = p
		}
		p.registered++
		p.attempts += len(a.teams)
		switch {
		case a.validated:
			p.passed++
			if admitted[a.uid] {
				p.inOf++
			}
			if i := slices.IndexFunc(a.teams, func(t campusTeam) bool { return t.validated }); i >= 0 {
				if i == 0 {
					p.first++
				}
				if m := a.teams[i].mark; m != nil {
					p.marks = append(p.marks, *m)
				}
			}
		case a.open && !c.ended[a.uid]:
			p.open++
		case a.open:
			p.gone++ // still open once their Piscine was over: left unfinished
		case a.unmarked:
			p.unmarked++ // closed without a mark: neither passed nor failed
		default:
			p.failed++
		}
		for _, t := range a.teams {
			if t.failed() {
				p.reasons[c.reason(a.slug, t)]++
			}
		}
	}
	var out []any
	for _, slug := range slices.SortedFunc(func(yield func(string) bool) {
		for s := range rows {
			if !yield(s) {
				return
			}
		}
	}, func(a, b string) int { return strings.Compare(rows[a].name, rows[b].name) }) {
		p := rows[slug]
		reasons := map[string]any{}
		for _, r := range reasonOrder {
			reasons[r] = kAnon(p.reasons[r])
		}
		out = append(out, map[string]any{"slug": slug, "name": p.name, "registered": kAnon(p.registered), "passed": kAnon(p.passed),
			"failed": kAnon(p.failed), "in_progress": kAnon(p.open), "abandoned": kAnon(p.gone), "closed_unmarked": kAnon(p.unmarked), "attempts": kAnon(p.attempts), "first_try": kAnon(p.first),
			"median_mark": campusMedian(p.marks), "passed_admitted": kAnon(p.inOf), "reasons": reasons})
	}
	return map[string]any{
		"people":   map[string]any{"total": kAnon(counted), "admitted": kAnon(in), "not_admitted": kAnon(counted - in), "excluded": kAnon(len(c.people) - counted)},
		"piscines": piscines, "projects": out,
	}
}

// personKeys: fields a count never has; one of them anywhere means the file is something else (a report, raw API data).
var personKeys = map[string]bool{"login": true, "email": true, "first_name": true, "last_name": true, "displayname": true,
	"usual_full_name": true, "phone": true, "user": true, "users": true, "periods": true, "corrector": true, "correcteds": true}

// CheckCampusStats tells whether raw is a campus count (CampusCount and PiscineCount's totals, as runCampus writes them)
// and nothing else: what Server stats' import takes from make dev into production.
func CheckCampusStats(raw []byte) error {
	var v map[string]any
	if err := json.Unmarshal(raw, &v); err != nil {
		return errors.New("not JSON")
	}
	if _, err := time.Parse(time.RFC3339, Str(v, "generated_at")); err != nil {
		return errors.New("no generated_at")
	}
	if Obj(v, "people") == nil || Obj(v, "funnel") == nil || v["projects"] == nil {
		return errors.New("not a campus count")
	}
	var walk func(x any) error
	walk = func(x any) error {
		switch t := x.(type) {
		case map[string]any:
			for k, y := range t {
				if k == "logins" {
					if err := checkLogins(t, y); err != nil {
						return err
					}
					continue
				}
				if personKeys[k] {
					return fmt.Errorf("holds %q: a count holds nothing about anyone", k)
				}
				if err := walk(y); err != nil {
					return err
				}
			}
		case []any:
			for _, y := range t {
				if err := walk(y); err != nil {
					return err
				}
			}
		}
		return nil
	}
	return walk(v)
}

var loginPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,31}$`)

// checkLogins: a count names people only in a project row that 1 to 4 people signed up for (registered 1 to 4, or null in
// a count before policy v8), by login.
func checkLogins(row map[string]any, v any) error {
	list, ok := v.([]any)
	r, has := row["registered"]
	n, isNum := r.(float64)
	if !ok || !has || (r != nil && (!isNum || n < 1 || n > 4)) || Str(row, "slug") == "" || len(list) == 0 || len(list) > 4 {
		return errors.New("logins outside a project of fewer than 5 people")
	}
	for _, l := range list {
		if s, _ := l.(string); !loginPattern.MatchString(s) {
			return errors.New("logins holds something else than a login")
		}
	}
	return nil
}

// DropLogins takes the opted-out students out of a count's names (a project's logins), the key with them when none is
// left; with nobody to drop, or a count it can't read, it gives raw back as it was.
func DropLogins(raw []byte, optout []string) []byte {
	if len(optout) == 0 {
		return raw
	}
	gone := map[string]bool{}
	for _, l := range optout {
		gone[strings.ToLower(l)] = true
	}
	var v map[string]any
	if json.Unmarshal(raw, &v) != nil {
		return raw
	}
	for _, x := range List(v, "projects") {
		row, _ := x.(map[string]any)
		if row == nil || row["logins"] == nil {
			continue
		}
		var keep []any
		for _, l := range List(row, "logins") {
			if s, _ := l.(string); !gone[s] {
				keep = append(keep, l)
			}
		}
		if row["logins"] = keep; len(keep) == 0 {
			delete(row, "logins")
		}
	}
	out, err := json.Marshal(v)
	if err != nil {
		return raw
	}
	return out
}
