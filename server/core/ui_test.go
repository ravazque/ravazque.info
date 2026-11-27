package core

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
	"testing"
)

// The CSS of ui.json and ui.go, with the colours frozen in testdata/golden/colors.json: the owner changes colors.json as
// often as they like without touching this; a change to ui.json is regenerated with
// go run ./cmd/uicss -colors core/testdata/golden/colors.json > core/testdata/golden/ui.css
func TestCSSFromUIMatchesV1(t *testing.T) {
	colors, err := os.ReadFile("testdata/golden/colors.json")
	if err != nil {
		t.Fatal(err)
	}
	cfg, err := LoadUIWith(colors)
	if err != nil {
		t.Fatal(err)
	}
	want, err := os.ReadFile("testdata/golden/ui.css")
	if err != nil {
		t.Fatal(err)
	}
	if got := CSSFromUI(cfg); got != string(want) {
		gl, wl := strings.Split(got, "\n"), strings.Split(string(want), "\n")
		for i := range min(len(gl), len(wl)) {
			if gl[i] != wl[i] {
				t.Fatalf("line %d differs:\n got %.300s\nwant %.300s", i+1, gl[i], wl[i])
			}
		}
		t.Fatalf("length differs: %d vs %d lines", len(gl), len(wl))
	}
}

func TestValidateUIClean(t *testing.T) {
	cfg, _ := LoadUI()
	if errs := ValidateUI(cfg); len(errs) != 0 {
		t.Fatalf("shipped ui.json has errors: %v", errs)
	}
	bad, _ := ParseOrdered([]byte(`{"breakpoints":{"mobile":0},"tokens":{"light":{"x":"@nope","y":"12qq"}}}`))
	errs := ValidateUI(bad)
	if len(errs) != 2 || !strings.Contains(errs[0], "unknown reference @nope") || !strings.Contains(errs[1], "invalid value") {
		t.Fatalf("errors = %v", errs)
	}
}

func TestPanelGapIsTheSpaceAboveIt(t *testing.T) {
	p, _ := ParseOrdered([]byte(`{"span":12,"gap":"48px"}`))
	if got := strings.Join(panelRules("hours-month", p), " "); !strings.Contains(got, `[data-panel="hours-month"] { margin-top: 48px; }`) {
		t.Fatalf("rules = %s", got)
	}
	bad, _ := ParseOrdered([]byte(`{"breakpoints":{"mobile":0},"panels":{"hours-month":{"mobile":{"gap":"lots"}}}}`))
	if errs := ValidateUI(bad); len(errs) != 1 || !strings.Contains(errs[0], "panels.hours-month.mobile.gap") {
		t.Fatalf("errors = %v", errs)
	}
}

func TestOrderedJSONRoundTripKeepsEmptyLists(t *testing.T) {
	in := `{"a":[],"b":{"c":[[]],"d":null},"e":[1,{}]}`
	m, err := ParseOrdered([]byte(in))
	if err != nil {
		t.Fatal(err)
	}
	out, _ := json.Marshal(m)
	if string(out) != in {
		t.Fatalf("got %s", out)
	}
}

// The main colours live in colors.json for the owner to edit (2026-11-26): first the ones changed one at a time, by a plain
// name (who or what each marks), then the rest by token name; LoadUI adds them all to ui.json's tokens. Each is in both
// themes, described, and in one place only.
func TestColorsFileJoinsTheTokens(t *testing.T) {
	raw, err := Data.ReadFile("data/colors.json")
	if err != nil {
		t.Fatal(err)
	}
	colors, err := ParseOrdered(raw)
	if err != nil {
		t.Fatal(err)
	}
	uiRaw, _ := Data.ReadFile("data/ui.json")
	plain, _ := ParseOrdered(uiRaw)
	cfg, _ := LoadUI()
	hex := regexp.MustCompile(`^#[0-9a-fA-F]{6}$`) // a colour picker may write capitals
	main := colors.Obj("main")
	if got := strings.Join(main.Keys(), ","); got != "piscine,common-core,outer-core,alumni,alumni-edge,frozen,black-hole,ok,outstanding,fail" {
		t.Fatalf("main = %s", got)
	}
	seen := map[string]bool{}
	check := func(token, theme, value, what string) {
		if plain.Obj("tokens").Obj(theme).Has(token) {
			t.Errorf("%s also in ui.json (%s)", token, theme)
		}
		if got := cfg.Obj("tokens").Obj(theme).S(token); got != value || !hex.MatchString(got) {
			t.Errorf("%s/%s = %q, the file says %q", theme, token, got, value)
		}
		if what == "" {
			t.Errorf("%s has no description", token)
		}
	}
	for _, name := range main.Keys() {
		e := main.Obj(name)
		tok := e.S("token")
		if tok == "" || seen[tok] {
			t.Fatalf("%s: token %q", name, tok)
		}
		seen[tok] = true
		for _, theme := range []string{"light", "dark"} {
			check(tok, theme, e.S(theme), e.S("is"))
		}
	}
	light, dark := colors.Obj("light"), colors.Obj("dark")
	if strings.Join(light.Keys(), ",") != strings.Join(dark.Keys(), ",") || len(light.Keys()) < 10 {
		t.Fatalf("light %v, dark %v", light.Keys(), dark.Keys())
	}
	for _, theme := range []string{"light", "dark"} {
		for _, k := range colors.Obj(theme).Keys() {
			if seen[k] {
				t.Errorf("%s both in main and in %s", k, theme)
			}
			check(k, theme, colors.Obj(theme).S(k), colors.Obj("_what").S(k))
		}
	}
}
