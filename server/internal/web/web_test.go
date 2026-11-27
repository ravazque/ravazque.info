package web

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"ravazque.info/server/core"
	"ravazque.info/server/internal/app"
)

const secret = "0123456789abcdef0123456789abcdef-test"

func settings() app.Settings {
	return app.Settings{BaseURL: "https://localhost", FTUID: "u1", FTSecret: "s1", SessionSecret: secret,
		CooldownS: 3600, CacheS: 3600, SessionS: 604800, InsecureCookies: true, ContactEmail: "c@example.invalid",
		ControllerName: "Test", OwnerLogin: "tmidway"}
}

// fake42 answers sign-in: the token exchange, /v2/me and the coalitions; bloc is the Madrid bloc once a test sets it.
type fake42 struct {
	me       map[string]any
	bloc     atomic.Value
	blocs    atomic.Int64
	madrid   atomic.Int64
	requests atomic.Int64
	piscine  atomic.Int64 // the Piscine's part of a campus count began
	ended    atomic.Int64 // asked whether a Piscine ended
}

func (f *fake42) handler(w http.ResponseWriter, r *http.Request) {
	f.requests.Add(1)
	switch {
	case r.URL.Path == "/oauth/token":
		json.NewEncoder(w).Encode(map[string]any{"access_token": "SECRET-USER-TOKEN", "expires_in": 7200})
	case r.URL.Path == "/v2/me":
		json.NewEncoder(w).Encode(f.me)
	case strings.HasSuffix(r.URL.Path, "/coalitions"):
		w.Write([]byte(`[{"slug":"zefiria","color":"#E39F0B","name":"Zefiria"}]`))
	case r.URL.Path == "/v2/cursus/21/cursus_users" && r.URL.Query().Get("filter[campus_id]") == "22" && !r.URL.Query().Has("range[begin_at]"):
		f.madrid.Add(1)
		row := `{"cursus_id":21,"begin_at":"2024-10-07T08:00:00.000Z","level":%v,"user":{"staff?":false,"alumni?":false,"active?":true}}`
		fmt.Fprintf(w, "["+row+","+row+","+row+"]", 3.5, 9.1, 12)
	case r.URL.Path == "/v2/projects_users" || r.URL.Path == "/v2/scale_teams" || r.URL.Path == "/v2/cursus/9/cursus_users": // the campus statistics' lists, empty
		if r.URL.Path == "/v2/cursus/9/cursus_users" && r.URL.Query().Has("range[end_at]") {
			f.ended.Add(1) // "did a Piscine end then?": no
		}
		w.Write([]byte("[]"))
	case r.URL.Path == "/v2/cursus/9/projects":
		f.piscine.Add(1)
		w.Write([]byte(`[{"id":11,"slug":"c-piscine-c-00"}]`))
	case r.URL.Path == "/v2/blocs" && f.bloc.Load() != nil:
		f.blocs.Add(1)
		json.NewEncoder(w).Encode(f.bloc.Load())
	default:
		w.WriteHeader(404) // the first extraction fails at once (no retries): nothing here depends on it
	}
}

func student(id float64, login string) map[string]any {
	return map[string]any{"id": id, "login": login, "displayname": "T " + login, "staff?": false, "active?": true,
		"image":        map[string]any{"versions": map[string]any{"medium": "https://cdn.intra.42.fr/users/x.jpg"}},
		"campus_users": []any{map[string]any{"campus_id": 22.0, "is_primary": true}},
		"cursus_users": []any{map[string]any{"cursus_id": 21.0, "begin_at": "2025-01-01T07:42:00.000Z", "end_at": nil, "grade": nil}}}
}

type env struct {
	srv  *httptest.Server
	s    *Server
	f    *fake42
	jar  http.CookieJar
	hc   *http.Client
	csrf string
}

func newEnv(t *testing.T, mod func(*app.Settings)) *env {
	t.Helper()
	f := &fake42{me: student(990002, "tmidway")}
	api := httptest.NewServer(http.HandlerFunc(f.handler))
	t.Cleanup(api.Close)
	st := settings()
	if mod != nil {
		mod(&st)
	}
	static := fstest.MapFS{"index.html": {Data: []byte("<!doctype html><title>spa</title>")}, "assets/app.js": {Data: []byte("1")}}
	s := New(st, static, Options{APIBase: api.URL, CDN: "https://cdn.intra.42.fr/", Now: time.Now})
	t.Cleanup(s.Close)
	srv := httptest.NewServer(s)
	t.Cleanup(srv.Close)
	jar, _ := cookiejar.New(nil)
	hc := &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	return &env{srv: srv, s: s, f: f, jar: jar, hc: hc}
}

func (e *env) do(t *testing.T, method, path string, body io.Reader, hdr map[string]string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(method, e.srv.URL+path, body)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	if e.csrf != "" && method != "GET" && req.Header.Get("X-CSRF-Token") == "" {
		req.Header.Set("X-CSRF-Token", e.csrf)
	}
	r, err := e.hc.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	return r
}

func readAll(r *http.Response) string {
	b, _ := io.ReadAll(r.Body)
	r.Body.Close()
	return string(b)
}

// signIn goes through /auth/login and /auth/callback and keeps the CSRF token of the session.
func (e *env) signIn(t *testing.T) *http.Response {
	t.Helper()
	r := e.do(t, "GET", "/auth/login?accept=1", nil, nil)
	loc, _ := url.Parse(r.Header.Get("Location"))
	state := loc.Query().Get("state")
	r = e.do(t, "GET", "/auth/callback?code=C&state="+state, nil, nil)
	var sess struct {
		User struct{ CSRF string } `json:"user"`
	}
	json.Unmarshal([]byte(readAll(e.do(t, "GET", "/api/session", nil, nil))), &sess)
	e.csrf = sess.User.CSRF
	return r
}

func (e *env) seed(t *testing.T, uid int, file string) {
	t.Helper()
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	e.s.Store.SaveRaw(uid, raw)
	e.s.Store.SetStatus(uid, app.Status{State: "done", Progress: 1, Last: time.Now().UTC().Format(time.RFC3339)})
}

func TestHealthUICSSAndSPA(t *testing.T) {
	e := newEnv(t, nil)
	if r := e.do(t, "GET", "/healthz", nil, nil); r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
	if r := e.do(t, "GET", "/ui.css", nil, nil); r.StatusCode != 200 || !strings.Contains(readAll(r), "--accent") {
		t.Fatal("ui.css")
	}
	for _, p := range []string{"/", "/app", "/app/projects", "/privacy", "/refused"} {
		r := e.do(t, "GET", p, nil, nil)
		if body := readAll(r); r.StatusCode != 200 || !strings.Contains(body, "<title>spa") {
			t.Fatalf("%s: %d %s", p, r.StatusCode, body)
		}
		if csp := r.Header.Get("Content-Security-Policy"); !strings.Contains(csp, "script-src 'self'") || r.Header.Get("X-Frame-Options") != "DENY" ||
			r.Header.Get("Cross-Origin-Opener-Policy") != "same-origin" || !strings.Contains(r.Header.Get("Permissions-Policy"), "camera=()") {
			t.Fatalf("%s: headers %v", p, r.Header)
		}
	}
	if r := e.do(t, "GET", "/assets/app.js", nil, nil); !strings.Contains(r.Header.Get("Cache-Control"), "immutable") {
		t.Fatal("assets are immutable")
	}
	if r := e.do(t, "GET", "/api/nope", nil, nil); r.StatusCode != 404 {
		t.Fatal("unknown API path")
	}
}

func TestLoginNeedsConsent(t *testing.T) {
	e := newEnv(t, nil)
	cross := map[string]string{"Sec-Fetch-Site": "cross-site"} // a link from elsewhere can't tick the box for you
	if r := e.do(t, "GET", "/auth/login?accept=1", nil, cross); r.StatusCode != 303 || r.Header.Get("Location") != "/?error=consent" {
		t.Fatalf("a link from another site accepted the policy: %d %s", r.StatusCode, r.Header.Get("Location"))
	}
	if r := e.do(t, "GET", "/auth/login", nil, nil); r.StatusCode != 303 || r.Header.Get("Location") != "/?error=consent" {
		t.Fatal(r.StatusCode, r.Header.Get("Location"))
	}
	r := e.do(t, "GET", "/auth/login?accept=1", nil, nil)
	loc, _ := url.Parse(r.Header.Get("Location"))
	if loc.Query().Get("client_id") != "u1" || loc.Query().Get("redirect_uri") != "https://localhost/auth/callback" || loc.Query().Get("state") == "" {
		t.Fatal(loc)
	}
}

func TestCallbackSignsInWithoutLeakingTheToken(t *testing.T) {
	e := newEnv(t, nil)
	r := e.signIn(t)
	if r.StatusCode != 303 || r.Header.Get("Location") != "/app" {
		t.Fatal(r.StatusCode, r.Header.Get("Location"))
	}
	var sessCookie *http.Cookie
	for _, c := range r.Cookies() {
		if c.Name == app.SessionCookie {
			sessCookie = c
		}
		if strings.Contains(c.Value, "SECRET-USER-TOKEN") {
			t.Fatal("the user token reached a cookie")
		}
	}
	if sessCookie == nil || !sessCookie.HttpOnly || sessCookie.Path != "/" || sessCookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("session cookie %+v", sessCookie)
	}
	body := readAll(e.do(t, "GET", "/api/session", nil, nil))
	if strings.Contains(body, "SECRET-USER-TOKEN") || !strings.Contains(body, `"login":"tmidway"`) || !strings.Contains(body, `"owner":true`) {
		t.Fatal(body)
	}
	e.s.Jobs.Drain()
	if st := readAll(e.do(t, "GET", "/api/me/status", nil, nil)); !strings.Contains(st, `"state":"failed"`) {
		t.Fatalf("the first extraction was queued and ran: %s", st)
	}
}

func TestCallbackRefusesAndLimits(t *testing.T) {
	e := newEnv(t, nil)
	e.f.me = student(5, "staffer")
	e.f.me["staff?"] = true
	if r := e.signIn(t); r.Header.Get("Location") != "/refused?reason=staff" {
		t.Fatal(r.Header.Get("Location"))
	}
	if r := e.do(t, "GET", "/auth/callback?code=C&state=forged", nil, nil); r.StatusCode != 400 {
		t.Fatal(r.StatusCode)
	}
	e2 := newEnv(t, nil)
	var last int
	for range 11 {
		r := e2.do(t, "GET", "/auth/login?accept=1", nil, nil)
		loc, _ := url.Parse(r.Header.Get("Location"))
		last = e2.do(t, "GET", "/auth/callback?code=C&state="+loc.Query().Get("state"), nil, nil).StatusCode
	}
	if last != 429 {
		t.Fatalf("11th callback: %d", last)
	}
}

func TestAPINeedsSessionAndCSRF(t *testing.T) {
	e := newEnv(t, nil)
	if r := e.do(t, "GET", "/api/me/status", nil, nil); r.StatusCode != 401 {
		t.Fatal(r.StatusCode)
	}
	e.signIn(t)
	for _, p := range []string{"/api/me/refresh", "/api/me/delete", "/api/me/publish", "/api/me/consent", "/auth/logout"} {
		if r := e.do(t, "POST", p, nil, map[string]string{"X-CSRF-Token": "wrong"}); r.StatusCode != 403 {
			t.Fatalf("%s: %d", p, r.StatusCode)
		}
	}
}

func TestViewTodayAndConsent(t *testing.T) {
	e := newEnv(t, nil)
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/mid.report.json")
	r := e.do(t, "GET", "/api/me/view?period=all", nil, nil)
	var v map[string]any
	json.Unmarshal([]byte(readAll(r)), &v)
	if r.StatusCode != 200 || v["period"] != "all" || v["report"] == nil || v["derive"] == nil || v["layout"] == nil || v["network"] == nil {
		t.Fatalf("%d %v", r.StatusCode, keys(v))
	}
	// All is the default since 2026-11-20 (owner), whatever period a saved report names
	for _, q := range []string{"?period=bogus", ""} {
		if r := e.do(t, "GET", "/api/me/view"+q, nil, nil); r.StatusCode != 200 || !strings.Contains(readAll(r), `"period":"all"`) {
			t.Fatalf("view%s falls back to all", q)
		}
	}
	e.s.M.Delete(e.s.M.Keys("consent:*")...)
	if r := e.do(t, "GET", "/api/me/view", nil, nil); r.StatusCode != 409 {
		t.Fatalf("no consent: %d", r.StatusCode)
	}
	if r := e.do(t, "POST", "/api/me/consent", strings.NewReader(`{"accept":true}`), nil); r.StatusCode != 204 {
		t.Fatal(r.StatusCode)
	}
	if r := e.do(t, "GET", "/api/me/view", nil, nil); r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
}

// A Piscine project you corrected as a student (a rush) is the Piscine period's for the report, but its feedback is the
// student's: the student view hands those evaluations, from the kickoff on, to Feedback; the other views carry none.
func TestStudentViewHandsFeedbackThePiscineEvaluationsFromTheKickoff(t *testing.T) {
	e := newEnv(t, nil)
	e.signIn(t)
	e.s.Jobs.Drain()
	raw, err := os.ReadFile("../../core/testdata/golden/mid.report.json")
	if err != nil {
		t.Fatal(err)
	}
	var doc map[string]any
	json.Unmarshal(raw, &doc)
	piscine := doc["periods"].(map[string]any)["piscine"].(map[string]any)
	rush := func(id float64, begin string) map[string]any {
		return map[string]any{"id": id, "project": "C Piscine Rush 00", "cursus": []any{"C Piscine"}, "begin": begin, "feedbacks": []any{}}
	}
	piscine["given"] = []any{rush(900101, "2025-08-10 10:00"), rush(900102, "2025-11-02 10:00")} // the kickoff is 2025-08-29 09:42
	file := filepath.Join(t.TempDir(), "report.json")
	out, _ := json.Marshal(doc)
	os.WriteFile(file, out, 0o600)
	e.seed(t, 990002, file)
	view := func(period string) map[string]any {
		var v map[string]any
		json.Unmarshal([]byte(readAll(e.do(t, "GET", "/api/me/view?period="+period, nil, nil))), &v)
		return v
	}
	got, _ := view("student")["piscine_as_student"].(map[string]any)
	given, _ := got["given"].([]any)
	if len(given) != 1 || given[0].(map[string]any)["id"] != 900102.0 {
		t.Fatalf("student: %v", got)
	}
	for _, p := range []string{"piscine", "all"} {
		if v := view(p); v["piscine_as_student"] != nil {
			t.Fatalf("%s: %v", p, v["piscine_as_student"])
		}
	}
}

func keys(m map[string]any) []string {
	var out []string
	for k := range m {
		out = append(out, k)
	}
	return out
}

// Another device, or the same one after a restart or an hour unused, gets the report from the server's disk.
func TestReportComesBackFromDisk(t *testing.T) {
	dir := t.TempDir()
	e := newEnv(t, func(s *app.Settings) { s.ReportsDir = dir })
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/new.report.json")
	e.s.M.Delete("user:990002:data", "user:990002:status")
	if r := e.do(t, "GET", "/api/me/view", nil, nil); r.StatusCode != 200 {
		t.Fatalf("view after memory loss: %d", r.StatusCode)
	}
	if r := e.do(t, "GET", "/api/me/report.json", nil, nil); r.StatusCode != 404 {
		t.Fatalf("the browser copy endpoint is still there: %d", r.StatusCode)
	}
}

// A report is kept with the opted-out students already hidden: they never reach the disk.
func TestKeptReportHidesOptedOutStudents(t *testing.T) {
	dir := t.TempDir()
	e := newEnv(t, func(s *app.Settings) { s.ReportsDir = dir; s.OptoutLogins = []string{"peer03"} })
	raw, err := os.ReadFile("../../core/testdata/golden/mid.report.json")
	if err != nil || !strings.Contains(string(raw), `"peer03"`) {
		t.Fatal("fixture")
	}
	e.s.Store.SaveRaw(990002, e.s.stored(raw)) // as extractJob keeps it
	fresh := app.NewStore(app.NewMemory(time.Now), e.s.S, time.Now)
	got := string(fresh.LoadRaw(990002))
	if got == "" || strings.Contains(got, `"peer03"`) || strings.Contains(got, "Peer 03") {
		t.Fatal("an opted-out student reached the disk")
	}
}

// With no report on the server, the status alone starts nothing (the browser hands its copy back first); with kick it
// starts an extraction, also while the status still says done.
func TestStatusExtractsOnlyWhenKicked(t *testing.T) {
	e := newEnv(t, nil)
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/new.report.json")
	e.s.Store.DropReport(990002)
	e.s.M.Delete(e.s.M.Keys("cooldown:*")...)
	if r := readAll(e.do(t, "GET", "/api/me/status", nil, nil)); !strings.Contains(r, `"state":"done"`) || !strings.Contains(r, `"has_report":false`) {
		t.Fatal(r)
	}
	// The worker may take the job before the answer is written: queued and running both mean it started.
	if r := readAll(e.do(t, "GET", "/api/me/status?kick=1", nil, nil)); !strings.Contains(r, `"state":"queued"`) && !strings.Contains(r, `"state":"running"`) {
		t.Fatal("kick with a done status and no report:", r)
	}
}

func TestDeleteLeavesNothingNamingTheUser(t *testing.T) {
	e := newEnv(t, nil)
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/new.report.json")
	r := e.do(t, "POST", "/api/me/delete", nil, nil)
	if r.StatusCode != 204 || !strings.Contains(r.Header.Get("Clear-Site-Data"), "storage") {
		t.Fatal(r.StatusCode)
	}
	for _, k := range e.s.M.Keys("*") {
		if strings.Contains(k, "990002") || strings.HasPrefix(k, "sess:") {
			t.Fatalf("left: %s", k)
		}
	}
	if r := e.do(t, "GET", "/api/me/status", nil, nil); r.StatusCode != 401 {
		t.Fatal("session survived")
	}
}

func TestOptedOutStudentsAreHidden(t *testing.T) {
	e := newEnv(t, func(s *app.Settings) { s.OptoutLogins = []string{"peer03", "tmidway"} })
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/mid.report.json")
	body := readAll(e.do(t, "GET", "/api/me/view?period=all", nil, nil))
	if strings.Contains(body, `"peer03"`) || strings.Contains(body, "Peer 03") {
		t.Fatal("an opted-out student is visible")
	}
	if !strings.Contains(body, `"tmidway"`) {
		t.Fatal("the viewer is never hidden")
	}
}

func TestPublishOwnerOnlyAndWhitelisted(t *testing.T) {
	var put []byte
	var putPath string
	gh := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == "GET" {
			w.WriteHeader(404)
			return
		}
		put, _ = io.ReadAll(r.Body)
		putPath = r.URL.Path
		w.Write([]byte(`{"commit":{"html_url":"https://github.example/c/1"}}`))
	}))
	defer gh.Close()
	e := newEnv(t, func(s *app.Settings) { s.GithubToken, s.GithubRepo = "gh-token", "o/r" })
	e.s.githubAPI = gh.URL
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/mid.report.json")
	r := e.do(t, "POST", "/api/me/publish", nil, nil)
	if body := readAll(r); r.StatusCode != 200 || !strings.Contains(body, "github.example") {
		t.Fatal(r.StatusCode, body)
	}
	if putPath != "/repos/o/r/contents/data/42.json" {
		t.Fatal("the snapshot goes to the root of the site's repository, got", putPath)
	}
	var b struct{ Content string }
	json.Unmarshal(put, &b)
	snap := string(mustB64(b.Content))
	for _, bad := range []string{"@", "c2r", "c3r", "peer", "990002", "hours", "image", "email", "location"} {
		if strings.Contains(snap, bad) {
			t.Fatalf("snapshot carries %q", bad)
		}
	}
	other := newEnv(t, func(s *app.Settings) { s.GithubToken, s.GithubRepo, s.OwnerLogin = "gh", "o/r", "someoneelse" })
	other.signIn(t)
	if r := other.do(t, "POST", "/api/me/publish", nil, nil); r.StatusCode != 403 {
		t.Fatal(r.StatusCode)
	}
	if r := other.do(t, "GET", "/api/stats", nil, nil); r.StatusCode != 403 {
		t.Fatal("stats are the owner's")
	}
	if r := e.do(t, "GET", "/api/stats", nil, nil); r.StatusCode != 200 {
		t.Fatal(r.StatusCode)
	}
}

func TestStatsListWhoSignedInAndDeleteForgetsThem(t *testing.T) {
	e := newEnv(t, nil)
	e.signIn(t)
	e.s.Jobs.Drain()
	var st struct {
		Started  time.Time
		Visitors []struct {
			Login       string
			First, Last time.Time
		}
	}
	json.Unmarshal([]byte(readAll(e.do(t, "GET", "/api/stats", nil, nil))), &st)
	if len(st.Visitors) != 1 || st.Visitors[0].Login != "tmidway" || st.Visitors[0].Last.Before(st.Started) {
		t.Fatalf("the sign-in is listed, since the start: %+v", st)
	}
	e.do(t, "POST", "/api/me/delete", nil, nil)
	if len(e.s.Visitors.List()) != 0 {
		t.Fatal("Delete my data forgets the visit")
	}
}

func TestDevLoginOnlyInDevMode(t *testing.T) {
	e := newEnv(t, nil)
	if r := e.do(t, "GET", "/dev/login", nil, nil); r.StatusCode == 303 {
		t.Fatal("dev login outside dev mode")
	}
	dir := t.TempDir()
	for file, golden := range map[string]string{"test-new.json": "new", "real-mid.json": "mid"} {
		var rep map[string]any
		raw, _ := os.ReadFile("../../core/testdata/golden/" + golden + ".report.json")
		json.Unmarshal(raw, &rep)
		rep["test_profile"] = map[string]int{"new": 990001, "mid": 990002}[golden]
		raw, _ = json.Marshal(rep)
		os.WriteFile(dir+"/"+file, raw, 0o600)
	}
	d := newEnv(t, func(s *app.Settings) { s.DevProfiles = dir + "/test-*.json " + dir + "/real-*.json" })
	if body := readAll(d.do(t, "GET", "/api/session", nil, nil)); !strings.Contains(body, "Test · tnova") || !strings.Contains(body, "Real · tmidway") {
		t.Fatal(body)
	}
	if r := d.do(t, "GET", "/dev/login?as=tnova", nil, nil); r.StatusCode != 303 {
		t.Fatal(r.StatusCode)
	}
	if body := readAll(d.do(t, "GET", "/api/session", nil, nil)); !strings.Contains(body, `"login":"tnova"`) {
		t.Fatal(body)
	}
	if body := readAll(d.do(t, "GET", "/api/me/view", nil, nil)); !strings.Contains(body, `"tnova"`) {
		t.Fatal("the test profile's report")
	}
	var buf bytes.Buffer
	buf.WriteString("")
}

func TestDeleteEndsEverySessionAndTheReport(t *testing.T) {
	e := newEnv(t, nil)
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/new.report.json")
	other := newEnvSharing(t, e) // a second device signed in as the same user
	if r := e.do(t, "POST", "/api/me/delete", nil, nil); r.StatusCode != 204 {
		t.Fatal(r.StatusCode)
	}
	if r := other.do(t, "GET", "/api/me/status", nil, nil); r.StatusCode != 401 {
		t.Fatalf("the other device's session survived: %d", r.StatusCode)
	}
	sid := e.s.Sessions.Create(app.Session{ID: 990002, Login: "tmidway"})
	if e.s.Store.LoadRaw(990002) != nil {
		t.Fatal("the report outlived Delete my data")
	}
	for _, k := range e.s.M.Keys("*") {
		if strings.HasPrefix(k, "sess:") {
			raw, _ := e.s.M.Get(k)
			if strings.Contains(string(raw), "tmidway") && !strings.Contains(k, sid) {
				t.Fatalf("a session naming the user is left: %s", k)
			}
		}
	}
}

func TestAvatarIsCachedAndOnlyAnImage(t *testing.T) {
	var cdn atomic.Int64
	e := newEnv(t, nil)
	cdnSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cdn.Add(1)
		w.Header().Set("Content-Type", "text/html")
		w.Write([]byte("<script>x</script>"))
	}))
	defer cdnSrv.Close()
	e.s.API.CDN = cdnSrv.URL + "/"
	sid := e.s.Sessions.Create(app.Session{ID: 5, Login: "tnova", Image: cdnSrv.URL + "/users/x.jpg"})
	e.jar.SetCookies(mustURL(e.srv.URL), []*http.Cookie{{Name: app.SessionCookie, Value: sid, Path: "/"}})
	for range 3 {
		r := e.do(t, "GET", "/avatar/me", nil, nil)
		if ct := r.Header.Get("Content-Type"); ct != "image/jpeg" {
			t.Fatalf("content type %q", ct)
		}
		readAll(r)
	}
	if cdn.Load() != 1 {
		t.Fatalf("the CDN was asked %d times", cdn.Load())
	}
}

func TestCoalitionImagesOnlyFromTheCDNAndNeverRunning(t *testing.T) {
	var cdn atomic.Int64
	e := newEnv(t, nil)
	cdnSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cdn.Add(1)
		w.Header().Set("Content-Type", "image/svg+xml")
		w.Write([]byte(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`))
	}))
	defer cdnSrv.Close()
	e.s.API.CDN = cdnSrv.URL + "/"
	e.f.bloc.Store([]any{map[string]any{"id": 1.0, "coalitions": []any{map[string]any{"id": 7.0, "name": "A", "score": 1.0, "color": "#000000",
		"image_url": cdnSrv.URL + "/coalition/image/1/logo.svg"}}}})
	if _, err := e.s.API.Bloc(context.Background(), time.Now()); err != nil {
		t.Fatal(err)
	}
	logo := "/api/me/coalition-image?u=" + url.QueryEscape(cdnSrv.URL+"/coalition/image/1/logo.svg")
	if r := e.do(t, "GET", logo, nil, nil); r.StatusCode != 401 {
		t.Fatalf("signed out: %d", r.StatusCode)
	}
	sid := e.s.Sessions.Create(app.Session{ID: 5, Login: "tnova"})
	e.jar.SetCookies(mustURL(e.srv.URL), []*http.Cookie{{Name: app.SessionCookie, Value: sid, Path: "/"}})
	for range 3 {
		r := e.do(t, "GET", logo, nil, nil)
		if r.StatusCode != 200 || r.Header.Get("Content-Type") != "image/svg+xml" || !strings.Contains(r.Header.Get("Content-Security-Policy"), "sandbox") ||
			r.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Fatalf("logo: %d %v", r.StatusCode, r.Header)
		}
		readAll(r)
	}
	if cdn.Load() != 1 {
		t.Fatalf("the CDN was asked %d times", cdn.Load())
	}
	for _, u := range []string{cdnSrv.URL + "/users/x.jpg", "https://example.com/coalition/a.svg", cdnSrv.URL + "/coalition/../users/x.jpg",
		cdnSrv.URL + "/coalition/%2e%2e/users/x.jpg", cdnSrv.URL + "/coalition/image/2/other.svg"} {
		if r := e.do(t, "GET", "/api/me/coalition-image?u="+url.QueryEscape(u), nil, nil); r.StatusCode != 404 {
			t.Fatalf("%s: %d", u, r.StatusCode)
		}
	}
	if cdn.Load() != 1 { // asking for what the bloc does not have spends nothing of the shared budget
		t.Fatalf("the CDN was asked %d times", cdn.Load())
	}
}

func TestCoalitionsFollowTheQuarterHourWithTheirImagesInMemory(t *testing.T) {
	var cdn atomic.Int64
	e := newEnv(t, nil)
	cdnSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		cdn.Add(1)
		w.Header().Set("Content-Type", "image/png")
		w.Write([]byte("PNG"))
	}))
	defer cdnSrv.Close()
	e.s.API.CDN = cdnSrv.URL + "/"
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/mid.report.json")
	standing := func(path string) []map[string]any {
		var v struct{ Coalitions []map[string]any }
		json.Unmarshal([]byte(readAll(e.do(t, "GET", path, nil, nil))), &v)
		return v.Coalitions
	}
	if cs := standing("/api/me/view"); len(cs) != 4 {
		t.Fatalf("before the first refresh the report's own standing shows: %v", cs)
	}
	e.f.bloc.Store([]any{map[string]any{"coalitions": []any{
		map[string]any{"id": 8, "name": "Coalition C", "color": "#5BA35B", "score": 80000},
		map[string]any{"id": 7, "name": "Zefiria", "color": "#E39F0B", "score": 90000,
			"image_url": cdnSrv.URL + "/coalition/image/7/logo.svg", "cover_url": cdnSrv.URL + "/coalition/cover/7/cover.jpg"},
	}}})
	e.s.now = func() time.Time { return time.Date(2026, 11, 1, 12, 5, 0, 0, time.UTC) }
	e.s.refreshCoalitions(context.Background())
	e.s.refreshCoalitions(context.Background()) // the same quarter: nothing is asked again
	if e.f.blocs.Load() != 1 || cdn.Load() != 2 {
		t.Fatalf("bloc asked %d times, CDN %d", e.f.blocs.Load(), cdn.Load())
	}
	for _, path := range []string{"/api/me/coalitions", "/api/me/view"} {
		cs := standing(path)
		if len(cs) != 2 || cs[0]["name"] != "Zefiria" || cs[0]["rank"] != 1.0 || cs[0]["score"] != 90000.0 || cs[0]["mine"] != true || cs[1]["mine"] != false {
			t.Fatalf("%s: %v", path, cs)
		}
	}
	if r := e.do(t, "GET", "/api/me/coalition-image?u="+url.QueryEscape(cdnSrv.URL+"/coalition/image/7/logo.svg"), nil, nil); r.StatusCode != 200 || cdn.Load() != 2 {
		t.Fatalf("logo: %d, CDN %d", r.StatusCode, cdn.Load())
	}
}

func mustURL(s string) *url.URL { u, _ := url.Parse(s); return u }

// newEnvSharing: another browser against the same server, signed in as the same user.
func newEnvSharing(t *testing.T, e *env) *env {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	o := &env{srv: e.srv, s: e.s, f: e.f, jar: jar, hc: &http.Client{Jar: jar, CheckRedirect: e.hc.CheckRedirect}}
	o.signIn(t)
	return o
}

func TestTestProfilesNeverReachThe42API(t *testing.T) {
	dir := t.TempDir()
	var test map[string]any
	traw, _ := os.ReadFile("../../core/testdata/golden/new.report.json")
	json.Unmarshal(traw, &test)
	test["test_profile"] = 990001
	traw, _ = json.Marshal(test)
	os.WriteFile(dir+"/test-new.json", traw, 0o600)
	d := newEnv(t, func(s *app.Settings) { s.DevProfiles = dir + "/test-*.json" })
	d.do(t, "GET", "/dev/login?as=tnova", nil, nil)
	var sess struct{ User struct{ CSRF string } }
	json.Unmarshal([]byte(readAll(d.do(t, "GET", "/api/session", nil, nil))), &sess)
	d.csrf = sess.User.CSRF
	before := d.f.requests.Load()
	d.do(t, "POST", "/api/me/refresh", nil, nil)
	d.do(t, "POST", "/api/me/delete", nil, nil)
	d.do(t, "GET", "/dev/login?as=tnova", nil, nil) // back after deleting: the profile is there again
	json.Unmarshal([]byte(readAll(d.do(t, "GET", "/api/session", nil, nil))), &sess)
	d.csrf = sess.User.CSRF
	d.do(t, "GET", "/api/me/status?kick=1", nil, nil)
	d.s.Jobs.Drain()
	if n := d.f.requests.Load() - before; n != 0 {
		t.Fatalf("a test profile sent %d requests to 42", n)
	}
	if r := d.do(t, "GET", "/api/me/view", nil, nil); r.StatusCode != 200 {
		t.Fatalf("the test profile's report after deleting: %d", r.StatusCode)
	}
}

// make dev only: the owner's button forgets the saved report on the server (as after an hour unused) and turns it live,
// so the next refresh asks 42; refused to anyone else, absent without dev profiles.
func TestDevLiveTurnsTheOwnersSavedReportLive(t *testing.T) {
	dir := t.TempDir()
	var rep map[string]any
	raw, _ := os.ReadFile("../../core/testdata/golden/new.report.json")
	json.Unmarshal(raw, &rep)
	rep["test_profile"] = 990001
	raw, _ = json.Marshal(rep)
	os.WriteFile(dir+"/real-tnova.json", raw, 0o600)
	devAs := func(owner string) *env {
		d := newEnv(t, func(s *app.Settings) { s.DevProfiles = dir + "/real-*.json"; s.OwnerLogin = owner })
		d.do(t, "GET", "/dev/login?as=tnova", nil, nil)
		var sess struct{ User struct{ CSRF string } }
		json.Unmarshal([]byte(readAll(d.do(t, "GET", "/api/session", nil, nil))), &sess)
		d.csrf = sess.User.CSRF
		return d
	}
	d := devAs("tnova")
	if r := d.do(t, "POST", "/api/me/refresh", nil, nil); r.StatusCode != http.StatusConflict {
		t.Fatal("a saved report is frozen until it turns live:", r.StatusCode)
	}
	if r := d.do(t, "POST", "/dev/live", nil, nil); r.StatusCode != http.StatusNoContent {
		t.Fatal(r.StatusCode)
	}
	if st := readAll(d.do(t, "GET", "/api/me/status", nil, nil)); !strings.Contains(st, `"state":"none"`) || !strings.Contains(st, `"has_report":false`) || strings.Contains(st, `"frozen"`) {
		t.Fatal(st)
	}
	if r := d.do(t, "POST", "/api/me/refresh", nil, nil); r.StatusCode != http.StatusAccepted {
		t.Fatal("live: the refresh extracts", r.StatusCode)
	}
	if r := devAs("someone").do(t, "POST", "/dev/live", nil, nil); r.StatusCode != http.StatusForbidden {
		t.Fatal("not the owner:", r.StatusCode)
	}
	p := newEnv(t, nil)
	p.signIn(t)
	if r := p.do(t, "POST", "/dev/live", nil, nil); r.StatusCode == http.StatusNoContent {
		t.Fatal("without dev profiles there is no /dev/live")
	}
}

func mustB64(s string) []byte {
	b, _ := base64.StdEncoding.DecodeString(s)
	return b
}

func TestViewTellsYourPlaceInMadridReadInTheBackgroundOncePerHour(t *testing.T) {
	e := newEnv(t, nil)
	e.signIn(t)
	e.s.Jobs.Drain()
	e.seed(t, 990002, "../../core/testdata/golden/mid.report.json")
	view := func() map[string]any {
		var v map[string]any
		json.Unmarshal([]byte(readAll(e.do(t, "GET", "/api/me/view", nil, nil))), &v)
		return v
	}
	if v := view(); v["madrid"] != nil {
		t.Fatalf("a standing before Madrid was read: %v", v["madrid"])
	}
	var m map[string]any
	for end := time.Now().Add(5 * time.Second); m == nil && time.Now().Before(end); time.Sleep(20 * time.Millisecond) {
		m, _ = view()["madrid"].(map[string]any)
	}
	if m == nil || m["size"] != 3.0 || m["rank"] != 3.0 || m["top"] != 100.0 { // level 8.41 under 9.1 and 12, over 3.5
		t.Fatalf("madrid %v", m)
	}
	if n := e.f.madrid.Load(); n != 1 {
		t.Fatalf("Madrid read %d times in one hour", n)
	}
}

// The campus statistics: totals only, for signed-in users; the owner can start a count; it is kept on disk and read
// back at start-up.
func TestCampusStatsForSignedInUsersAndRunByTheOwner(t *testing.T) {
	file := filepath.Join(t.TempDir(), "campus.json")
	e := newEnv(t, func(s *app.Settings) { s.CampusStats = file })
	if r := e.do(t, "GET", "/api/campus-stats", nil, nil); r.StatusCode != 401 {
		t.Fatalf("signed out: %d", r.StatusCode)
	}
	e.signIn(t)
	e.s.Jobs.Drain()
	var got struct {
		Running bool           `json:"running"`
		Stats   map[string]any `json:"stats"`
	}
	json.Unmarshal([]byte(readAll(e.do(t, "GET", "/api/campus-stats", nil, nil))), &got)
	if got.Running || got.Stats != nil {
		t.Fatalf("before any count: %+v", got)
	}
	if r := e.do(t, "POST", "/api/campus-stats/run", nil, nil); r.StatusCode != 202 {
		t.Fatalf("run: %d", r.StatusCode)
	}
	for deadline := time.Now().Add(20 * time.Second); ; {
		json.Unmarshal([]byte(readAll(e.do(t, "GET", "/api/campus-stats", nil, nil))), &got)
		if got.Stats != nil && !got.Running {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("the count never ended")
		}
		time.Sleep(100 * time.Millisecond)
	}
	if got.Stats["generated_at"] == nil || got.Stats["requests"] == nil || got.Stats["people"] == nil || got.Stats["piscine"] == nil {
		t.Fatalf("stats %v", got.Stats)
	}
	if raw, err := os.ReadFile(file); err != nil || !strings.Contains(string(raw), `"generated_at"`) {
		t.Fatal("not kept on disk")
	}
	again := New(e.s.S, fstest.MapFS{}, Options{APIBase: e.srv.URL, Now: time.Now})
	defer again.Close()
	if again.campus.Load() == nil {
		t.Fatal("not read back at start-up")
	}
	other := newEnv(t, func(s *app.Settings) { s.OwnerLogin = "someone-else" })
	other.signIn(t)
	if r := other.do(t, "POST", "/api/campus-stats/run", nil, nil); r.StatusCode != 403 {
		t.Fatalf("a student started a count: %d", r.StatusCode)
	}
}

// Weekly on Monday at 04:00 in Madrid; at once (a minute after start) when there is no count or it is over a week old.
func TestNextCampusRun(t *testing.T) {
	wed := time.Date(2026, 11, 25, 15, 0, 0, 0, core.Madrid)
	if d := nextCampusRun(wed, ""); d != time.Minute {
		t.Fatalf("no count yet: %v", d)
	}
	if d := nextCampusRun(wed, "2026-11-10T03:00:00Z"); d != time.Minute {
		t.Fatalf("a count over a week old: %v", d)
	}
	want := time.Date(2026, 11, 30, 4, 0, 0, 0, core.Madrid).Sub(wed)
	if d := nextCampusRun(wed, "2026-11-23T03:00:00Z"); d != want {
		t.Fatalf("next Monday 04:00: %v, want %v", d, want)
	}
	mon := time.Date(2026, 11, 30, 3, 0, 0, 0, core.Madrid)
	if d := nextCampusRun(mon, "2026-11-23T03:00:00Z"); d != time.Hour {
		t.Fatalf("Monday before 04:00: %v", d)
	}
}

// Monday's count closes the site (owner, 2026-11-25): the session says so with when it should end, nobody but the owner
// gets their data or signs in, and once it ends everything is as before.
func TestMaintenanceWhileTheCampusIsCounted(t *testing.T) {
	e := newEnv(t, func(s *app.Settings) { s.OwnerLogin = "someone-else" })
	e.signIn(t)
	e.s.Jobs.Drain()
	owner := newEnvSharing(t, e) // signed in before (the fake 42 has one user: the owner is told apart by OwnerLogin)
	until := time.Now().Add(90 * time.Minute)
	e.s.startMaintenance(until)
	var sess struct {
		Maintenance *struct{ Until string } `json:"maintenance"`
	}
	json.Unmarshal([]byte(readAll(e.do(t, "GET", "/api/session", nil, nil))), &sess)
	if sess.Maintenance == nil || sess.Maintenance.Until != until.UTC().Format(time.RFC3339) {
		t.Fatalf("session %+v", sess.Maintenance)
	}
	if r := e.do(t, "GET", "/api/me/status", nil, nil); r.StatusCode != 503 {
		t.Fatalf("a student got through: %d", r.StatusCode)
	}
	if r := e.do(t, "GET", "/auth/login?accept=1", nil, nil); r.StatusCode != 303 || !strings.Contains(r.Header.Get("Location"), "maintenance") {
		t.Fatalf("sign-in during maintenance: %d %s", r.StatusCode, r.Header.Get("Location"))
	}
	owner.s.S.OwnerLogin = "tmidway"
	if r := owner.do(t, "GET", "/api/me/status", nil, nil); r.StatusCode != 200 {
		t.Fatalf("the owner was shut out: %d", r.StatusCode)
	}
	owner.s.S.OwnerLogin = "someone-else"
	e.s.endMaintenance()
	if r := e.do(t, "GET", "/api/me/status", nil, nil); r.StatusCode != 200 {
		t.Fatalf("after maintenance: %d", r.StatusCode)
	}
}

// A count made in make dev moves to production through the owner's own session: export there, import here; only a
// campus count is taken, and only from the owner.
func TestCampusCountMovesThroughTheOwner(t *testing.T) {
	file := filepath.Join(t.TempDir(), "campus.json")
	e := newEnv(t, func(s *app.Settings) { s.CampusStats = file })
	e.signIn(t)
	e.s.Jobs.Drain()
	count := `{"generated_at":"2026-11-25T17:00:00Z","requests":1766,"seconds":1962,"people":{"total":2517},"funnel":{},"projects":[]}`
	if r := e.do(t, "POST", "/api/campus-stats/import", strings.NewReader(count), nil); r.StatusCode != 200 {
		t.Fatalf("import: %d %s", r.StatusCode, readAll(r))
	}
	if raw, _ := os.ReadFile(file); !strings.Contains(string(raw), "2517") {
		t.Fatal("not kept on disk")
	}
	r := e.do(t, "GET", "/api/campus-stats/export", nil, nil)
	if body := readAll(r); r.StatusCode != 200 || !strings.Contains(body, `"requests":1766`) || !strings.Contains(r.Header.Get("Content-Disposition"), "attachment") {
		t.Fatalf("export: %d %s", r.StatusCode, body)
	}
	if r := e.do(t, "POST", "/api/campus-stats/import", strings.NewReader(`{"generated_at":"2026-11-25T17:00:00Z","people":{},"funnel":{},"projects":[{"login":"peer01"}]}`), nil); r.StatusCode != 400 {
		t.Fatalf("a file with a login: %d", r.StatusCode)
	}
	other := newEnv(t, func(s *app.Settings) { s.OwnerLogin = "someone-else" })
	other.signIn(t)
	for _, p := range []string{"/api/campus-stats/export"} {
		if r := other.do(t, "GET", p, nil, nil); r.StatusCode != 403 {
			t.Fatalf("%s for a student: %d", p, r.StatusCode)
		}
	}
	if r := other.do(t, "POST", "/api/campus-stats/import", strings.NewReader(count), nil); r.StatusCode != 403 {
		t.Fatalf("import by a student: %d", r.StatusCode)
	}
}

// The holy graph the owner draws in the editor: kept on the server (dev or production), read by every signed-in page,
// taken only from the owner and only if it is a holy graph; deleting it goes back to the one built into the app.
func TestHolyGraphFromTheEditor(t *testing.T) {
	file := filepath.Join(t.TempDir(), "holygraph.json")
	e := newEnv(t, func(s *app.Settings) { s.HolyGraph = file })
	e.signIn(t)
	e.s.Jobs.Drain()
	if r := e.do(t, "GET", "/api/holygraph", nil, nil); r.StatusCode != 204 {
		t.Fatalf("before any edit: %d", r.StatusCode)
	}
	raw, _ := core.Data.ReadFile("data/holygraph.json")
	var g map[string]any
	json.Unmarshal(raw, &g)
	g["layout"] = map[string]any{"ring_gap": 50.0}
	edited, _ := json.Marshal(g)
	if r := e.do(t, "PUT", "/api/holygraph", bytes.NewReader(edited), nil); r.StatusCode != 200 {
		t.Fatalf("save: %d %s", r.StatusCode, readAll(r))
	}
	if body := readAll(e.do(t, "GET", "/api/holygraph", nil, nil)); !strings.Contains(body, `"ring_gap":50`) {
		t.Fatal("the saved graph is not served")
	}
	if b, _ := os.ReadFile(file); !strings.Contains(string(b), `"ring_gap":50`) {
		t.Fatal("not kept on disk")
	}
	if r := e.do(t, "PUT", "/api/holygraph", strings.NewReader(`{"piscine":[],"login":"x"}`), nil); r.StatusCode != 400 {
		t.Fatalf("not a holy graph: %d", r.StatusCode)
	}
	other := newEnv(t, func(s *app.Settings) { s.OwnerLogin = "someone-else"; s.HolyGraph = file })
	other.signIn(t)
	if r := other.do(t, "PUT", "/api/holygraph", bytes.NewReader(edited), nil); r.StatusCode != 403 {
		t.Fatalf("a student saved a holy graph: %d", r.StatusCode)
	}
	if r := e.do(t, "DELETE", "/api/holygraph", nil, nil); r.StatusCode != 204 {
		t.Fatalf("reset: %d", r.StatusCode)
	}
	if r := e.do(t, "GET", "/api/holygraph", nil, nil); r.StatusCode != 204 {
		t.Fatalf("after reset: %d", r.StatusCode)
	}
}

// Monday's count reads the Piscine again only when it may have changed (owner, 2026-11-26): none kept yet, the opted-out
// students changed, the kept one over eight weeks old, or a Piscine ended since it was read (its results) or six weeks
// before (its admissions); a question that fails reads it too.
func TestPiscineDue(t *testing.T) {
	now := time.Date(2026, 11, 30, 3, 0, 0, 0, time.UTC)
	at := now.AddDate(0, 0, -7).Format(time.RFC3339)
	var spans [][2]time.Time
	none := func(from, to time.Time) (bool, error) {
		spans = append(spans, [2]time.Time{from, to})
		return false, nil
	}
	for _, c := range []struct {
		name string
		head piscineHead
		want bool
	}{
		{"none kept", piscineHead{}, true},
		{"unreadable date", piscineHead{Raw: []byte("{}"), At: "?", Optout: "fp"}, true},
		{"the opted-out changed", piscineHead{Raw: []byte("{}"), At: at, Optout: "other"}, true},
		{"over eight weeks old", piscineHead{Raw: []byte("{}"), At: now.AddDate(0, 0, -57).Format(time.RFC3339), Optout: "fp"}, true},
		{"nothing ended", piscineHead{Raw: []byte("{}"), At: at, Optout: "fp"}, false},
	} {
		spans = nil
		if got, _ := piscineDue(c.head, "fp", now, none); got != c.want {
			t.Errorf("%s: %v", c.name, got)
		}
	}
	last := now.AddDate(0, 0, -7)
	if len(spans) != 2 || spans[0] != [2]time.Time{last, now} || spans[1] != [2]time.Time{last.AddDate(0, 0, -42), now.AddDate(0, 0, -42)} {
		t.Fatalf("asked %v", spans)
	}
	head := piscineHead{Raw: []byte("{}"), At: at, Optout: "fp"}
	if got, why := piscineDue(head, "fp", now, func(from, _ time.Time) (bool, error) { return from.Equal(last.AddDate(0, 0, -42)), nil }); !got || why != "admissions" {
		t.Fatalf("admissions: %v %s", got, why)
	}
	if got, why := piscineDue(head, "fp", now, func(time.Time, time.Time) (bool, error) { return false, fmt.Errorf("503") }); !got || why != "unknown" {
		t.Fatalf("the question failed: %v %s", got, why)
	}
}

// Monday's count keeps the Piscine it read last week when nothing in it changed: two questions, not its ~2,700 requests;
// the owner's count reads it every time.
func TestMondayCountKeepsAnUnchangedPiscine(t *testing.T) {
	e := newEnv(t, nil)
	kept := map[string]any{"generated_at": time.Now().AddDate(0, 0, -7).UTC().Format(time.RFC3339), "optout": e.s.optoutPrint(), "people": map[string]any{"total": 4321.0}}
	b, _ := json.Marshal(map[string]any{"generated_at": kept["generated_at"], "people": map[string]any{}, "funnel": map[string]any{}, "projects": []any{}, "piscine": kept})
	e.s.campus.Store(&b)
	if err := e.s.runCampus(context.Background(), time.Now, false); err != nil {
		t.Fatal(err)
	}
	var got struct {
		Piscine map[string]any `json:"piscine"`
	}
	json.Unmarshal(*e.s.campus.Load(), &got)
	if e.f.piscine.Load() != 0 || e.f.ended.Load() != 2 || got.Piscine["people"].(map[string]any)["total"] != 4321.0 {
		t.Fatalf("read again: piscine %d, questions %d, kept %v", e.f.piscine.Load(), e.f.ended.Load(), got.Piscine)
	}
	if err := e.s.runCampus(context.Background(), time.Now, true); err != nil {
		t.Fatal(err)
	}
	json.Unmarshal(*e.s.campus.Load(), &got)
	if e.f.piscine.Load() != 1 || got.Piscine["generated_at"] == kept["generated_at"] || got.Piscine["optout"] != e.s.optoutPrint() {
		t.Fatalf("the owner's count kept it: %d %v", e.f.piscine.Load(), got.Piscine)
	}
}
