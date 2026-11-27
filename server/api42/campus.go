package api42

import (
	"context"
	"encoding/json"
	"errors"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"

	"ravazque.info/server/core"
)

// MadridCampus is 42 Madrid Fundación Telefónica's campus id.
const MadridCampus = 22

// Pages folds every page of a list, sorted by id (pages that don't overlap while the list changes), with `workers`
// requests at a time: the limiter hands each one to whichever app has a slot, so more apps go faster. gate runs before
// every request (the campus job's pace and its reserve for people signing in); its error stops the whole list.
func (c *Client) Pages(ctx context.Context, path string, params url.Values, workers int, gate func(context.Context) error, fold func([]any)) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	get := func(page int) ([]any, int, error) {
		if err := gate(ctx); err != nil {
			return nil, 0, err
		}
		p := url.Values{}
		for k, v := range params {
			p[k] = v
		}
		p.Set("sort", "id")
		p.Set("page[size]", strconv.Itoa(pageSize))
		p.Set("page[number]", strconv.Itoa(page))
		r, body, err := c.do(ctx, path, p, "")
		if err != nil {
			return nil, 0, err
		}
		var batch []any
		if err := json.Unmarshal(body, &batch); err != nil {
			return nil, 0, &Error{r.StatusCode, path}
		}
		total, _ := strconv.Atoi(r.Header.Get("X-Total"))
		return batch, total, nil
	}
	// a page the client gave up on after its own retries (a timeout, a run of 5xx) is asked twice more, a while apart:
	// one bad answer in ~1,770 must not end the whole count
	getAgain := func(page int) ([]any, int, error) {
		for try := 0; ; try++ {
			batch, total, err := get(page)
			var e *Error
			if err == nil || try == 2 || !errors.As(err, &e) || (e.Status != 0 && e.Status != 429 && e.Status < 500) {
				return batch, total, err
			}
			if err := c.sleep(ctx, 30*time.Second); err != nil {
				return nil, 0, err
			}
		}
	}
	first, total, err := getAgain(1)
	if err != nil {
		return err
	}
	fold(first)
	if total == 0 { // no total in the answer: one page after another until a short one
		for page, batch := 2, first; len(batch) == pageSize; page++ {
			if batch, _, err = getAgain(page); err != nil {
				return err
			}
			fold(batch)
		}
		return nil
	}
	next := make(chan int)
	var wg sync.WaitGroup
	var once sync.Once
	var failed error
	for range max(workers, 1) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for page := range next {
				batch, _, err := getAgain(page)
				if err != nil {
					once.Do(func() { failed = err; cancel() })
					return
				}
				fold(batch)
			}
		}()
	}
	pages := (total + pageSize - 1) / pageSize
feed:
	for page := 2; page <= pages; page++ {
		select {
		case next <- page:
		case <-ctx.Done():
			break feed
		}
	}
	close(next)
	wg.Wait()
	if failed != nil {
		return failed
	}
	return ctx.Err()
}

type list struct {
	path   string
	params url.Values
	fold   func([]any)
}

// lists folds several lists at once; the first error stops them all.
func lists(ctx context.Context, c *Client, workers int, gate func(context.Context) error, ls []list) error {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	errs := make([]error, len(ls))
	var wg sync.WaitGroup
	for i, l := range ls {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if errs[i] = c.Pages(ctx, l.path, l.params, workers, gate, l.fold); errs[i] != nil {
				cancel()
			}
		}()
	}
	wg.Wait()
	for _, err := range errs {
		if err != nil && !errors.Is(err, context.Canceled) {
			return err
		}
	}
	return ctx.Err()
}

// Campus reads the three campus-wide lists of 42 Madrid's 42cursus (enrolments, project attempts, evaluations) at once
// and folds them into count: ~1,770 requests in all (2026-11-25).
func Campus(ctx context.Context, c *Client, count *core.CampusCount, workers int, gate func(context.Context) error) error {
	campus, cursus := strconv.Itoa(MadridCampus), strconv.Itoa(core.MainCursus)
	return lists(ctx, c, workers, gate, []list{
		{"/v2/cursus/" + cursus + "/cursus_users", url.Values{"filter[campus_id]": {campus}}, count.People},
		{"/v2/projects_users", url.Values{"filter[campus]": {campus}, "filter[cursus]": {cursus}}, count.Attempts},
		{"/v2/scale_teams", url.Values{"filter[campus_id]": {campus}, "filter[cursus_id]": {cursus}}, count.Evaluations},
	})
}

// Piscine reads the C Piscine of 42 Madrid: its projects' ids (the API's cursus filter on attempts lets other cursus
// through, the project filter doesn't), then everyone who did it, their attempts and the Piscine's evaluations:
// ~2,700 requests (2026-11-25: 48 + 844 + 1,808).
func Piscine(ctx context.Context, c *Client, count *core.PiscineCount, workers int, gate func(context.Context) error) error {
	campus, cursus := strconv.Itoa(MadridCampus), strconv.Itoa(core.PiscineCursus)
	var ids []string
	err := c.Pages(ctx, "/v2/cursus/"+cursus+"/projects", nil, 1, gate, func(batch []any) {
		for _, x := range batch {
			p, _ := x.(map[string]any)
			if slug := core.Str(p, "slug"); strings.HasPrefix(slug, "c-piscine-") && !strings.Contains(slug, "checkpoint") {
				ids = append(ids, strconv.Itoa(int(core.Num(p, "id"))))
			}
		}
	})
	if err != nil {
		return err
	}
	if len(ids) == 0 {
		return &Error{0, "/v2/cursus/" + cursus + "/projects"}
	}
	return lists(ctx, c, workers, gate, []list{
		{"/v2/cursus/" + cursus + "/cursus_users", url.Values{"filter[campus_id]": {campus}}, count.People},
		{"/v2/projects_users", url.Values{"filter[campus]": {campus}, "filter[project_id]": {strings.Join(ids, ",")}}, count.Attempts},
		{"/v2/scale_teams", url.Values{"filter[campus_id]": {campus}, "filter[cursus_id]": {cursus}}, count.Evaluations},
	})
}

// PiscineEnded tells whether a C Piscine of 42 Madrid ended between from and to: one request, its enrolments by end_at
// (everyone of a Piscine ends it the same day; measured 2026-11-26: range[end_at] filters them).
func PiscineEnded(ctx context.Context, c *Client, gate func(context.Context) error, from, to time.Time) (bool, error) {
	if err := gate(ctx); err != nil {
		return false, err
	}
	path := "/v2/cursus/" + strconv.Itoa(core.PiscineCursus) + "/cursus_users"
	r, body, err := c.do(ctx, path, url.Values{"filter[campus_id]": {strconv.Itoa(MadridCampus)}, "page[size]": {"1"},
		"range[end_at]": {from.UTC().Format(time.RFC3339) + "," + to.UTC().Format(time.RFC3339)}}, "")
	if err != nil {
		return false, err
	}
	var rows []any
	if err := json.Unmarshal(body, &rows); err != nil {
		return false, &Error{r.StatusCode, path}
	}
	return len(rows) > 0, nil
}
