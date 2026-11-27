package core

import (
	"encoding/json"
	"fmt"
	"testing"
)

// holygraph.json (tools/holygraph/build.py) agrees with tracks.json: every Common Core project sits on its milestone's
// ring and on its track, and everything the graph draws has a name in its catalog.
func TestHolyGraphAgreesWithTracks(t *testing.T) {
	raw, err := Data.ReadFile("data/holygraph.json")
	if err != nil {
		t.Fatal(err)
	}
	var g struct {
		Piscine    [][]string                       `json:"piscine"`
		CommonCore map[string][][]any               `json:"common_core"`
		Projects   map[string]struct{ Name string } `json:"projects"`
		Outer      struct {
			Roots []string    `json:"roots"`
			Edges [][2]string `json:"edges"`
			Boxes map[string][]struct {
				Slug    string
				Modules []string
			} `json:"boxes"`
		} `json:"outer"`
	}
	if err := json.Unmarshal(raw, &g); err != nil {
		t.Fatal(err)
	}
	named := func(s string) {
		if g.Projects[s].Name == "" {
			t.Errorf("%s has no name in the catalog", s)
		}
	}
	var slugs func(x any) []string
	slugs = func(x any) []string {
		switch v := x.(type) {
		case string:
			return []string{v}
		case map[string]any:
			var out []string
			for _, y := range v {
				out = append(out, slugs(y)...)
			}
			return out
		case []any:
			var out []string
			for _, y := range v {
				out = append(out, slugs(y)...)
			}
			return out
		}
		return nil
	}
	for track, rings := range g.CommonCore {
		if len(rings) != 7 {
			t.Fatalf("%s: %d rings", track, len(rings))
		}
		for k, ring := range rings {
			for _, s := range slugs(ring) {
				named(s)
				if got := commonCore()[s]; got != fmt.Sprintf("rank-%02d", k) {
					t.Errorf("%s on %s's ring %d, tracks.json says %q", s, track, k, got)
				}
				if PythonSlug(s) && track == "c" {
					t.Errorf("%s is Python's, drawn on the C track", s)
				}
			}
		}
	}
	for _, row := range g.Piscine {
		for _, s := range row {
			named(s)
		}
	}
	for _, s := range g.Outer.Roots {
		named(s)
	}
	for _, e := range g.Outer.Edges {
		named(e[0])
		named(e[1])
	}
	for _, bs := range g.Outer.Boxes {
		for _, b := range bs {
			named(b.Slug)
			for _, m := range b.Modules {
				named(m)
			}
		}
	}
}

// A holy graph made in the editor (make dev) is taken only if it is one: both tracks' seven rings, every project it draws
// in its own catalog, layout numbers in range, nothing about anyone.
func TestCheckHolyGraph(t *testing.T) {
	raw, err := Data.ReadFile("data/holygraph.json")
	if err != nil {
		t.Fatal(err)
	}
	if err := CheckHolyGraph(raw); err != nil {
		t.Fatalf("the bundled holy graph refused: %v", err)
	}
	var g map[string]any
	json.Unmarshal(raw, &g)
	line := func(id string, from, to map[string]any) map[string]any {
		return map[string]any{"id": id, "from": from, "to": to}
	}
	var withLinks func(map[string]any) []byte
	mutate := func(f func(map[string]any)) []byte {
		var c map[string]any
		json.Unmarshal(raw, &c)
		f(c)
		b, _ := json.Marshal(c)
		return b
	}
	withLinks = func(l map[string]any) []byte { return mutate(func(c map[string]any) { c["links"] = l }) }
	withLayout := mutate(func(c map[string]any) {
		c["layout"] = map[string]any{"cc_node": 44.0, "ring_gap": 40.0, "outer_depth": 100.0}
	})
	if err := CheckHolyGraph(withLayout); err != nil {
		t.Fatalf("a layout refused: %v", err)
	}
	withNodes := mutate(func(c map[string]any) {
		c["nodes"] = map[string]any{"42cursus-libft": map[string]any{"dx": 30.0, "dy": -20.5, "r": 55.0, "shape": "diamond"}, "42cursus-scop": map[string]any{"shape": "pill"}}
	})
	if err := CheckHolyGraph(withLinks(map[string]any{"hide": []any{"libasm>b", ">libasm"}, "add": []any{
		line("l1", map[string]any{"node": "cc1"}, map[string]any{"line": "libasm>b", "t": 0.5}),
		line("l2", map[string]any{"line": "l1", "t": 0.25}, map[string]any{"x": 10.0, "y": -20.5}),
	}})); err != nil {
		t.Fatalf("the owner's lines refused: %v", err)
	}
	withGroups := mutate(func(c map[string]any) {
		c["outer"].(map[string]any)["groups"] = []any{map[string]any{"name": "Assembly", "slugs": []any{"libasm", "b", "cc1"}}}
	})
	if err := CheckHolyGraph(withGroups); err != nil {
		t.Fatalf("the owner's groups refused: %v", err)
	}
	if err := CheckHolyGraph(withNodes); err != nil {
		t.Fatalf("the editor's nodes refused: %v", err)
	}
	for name, bad := range map[string][]byte{
		"not json":  []byte(`{"piscine"`),
		"six rings": mutate(func(c map[string]any) { cc := c["common_core"].(map[string]any); cc["c"] = cc["c"].([]any)[:6] }),
		"an unknown slug": mutate(func(c map[string]any) {
			o := c["outer"].(map[string]any)
			o["roots"] = append(o["roots"].([]any), "made-up-project")
		}),
		"a person":                  mutate(func(c map[string]any) { c["login"] = "peer01" }),
		"a huge node":               mutate(func(c map[string]any) { c["layout"] = map[string]any{"cc_node": 900.0} }),
		"a node not in the catalog": mutate(func(c map[string]any) { c["nodes"] = map[string]any{"made-up": map[string]any{"dx": 1.0}} }),
		"a shape nobody draws":      mutate(func(c map[string]any) { c["nodes"] = map[string]any{"42cursus-libft": map[string]any{"shape": "star"}} }),
		"a node too big":            mutate(func(c map[string]any) { c["nodes"] = map[string]any{"42cursus-libft": map[string]any{"r": 500.0}} }),
		"a node far away":           mutate(func(c map[string]any) { c["nodes"] = map[string]any{"42cursus-libft": map[string]any{"dx": 90000.0}} }),
		"a group not in the catalog": mutate(func(c map[string]any) {
			c["outer"].(map[string]any)["groups"] = []any{map[string]any{"name": "Mine", "slugs": []any{"made-up"}}}
		}),
		"a group without a name": mutate(func(c map[string]any) {
			c["outer"].(map[string]any)["groups"] = []any{map[string]any{"name": " ", "slugs": []any{"libasm"}}}
		}),
		"a line to a project not in the catalog": withLinks(map[string]any{"add": []any{line("l1", map[string]any{"node": "made-up"}, map[string]any{"x": 1.0, "y": 2.0})}}),
		"a line's point off its line":            withLinks(map[string]any{"add": []any{line("l1", map[string]any{"node": "libasm"}, map[string]any{"line": "libasm>b", "t": 1.5})}}),
		"an end two things at once":              withLinks(map[string]any{"add": []any{line("l1", map[string]any{"node": "libasm", "x": 1.0}, map[string]any{"node": "b"})}}),
		"a line on a line that isn't":            withLinks(map[string]any{"add": []any{line("l1", map[string]any{"node": "libasm"}, map[string]any{"line": "l9", "t": 0.5})}}),
		"two lines with one id":                  withLinks(map[string]any{"add": []any{line("l1", map[string]any{"node": "libasm"}, map[string]any{"node": "b"}), line("l1", map[string]any{"node": "b"}, map[string]any{"node": "cc1"})}}),
		"a hidden line that is no link":          withLinks(map[string]any{"hide": []any{"libasm>cc1"}}),
		"a links field nothing reads":            withLinks(map[string]any{"colour": "red"}),
		"a node with more": mutate(func(c map[string]any) {
			c["nodes"] = map[string]any{"42cursus-libft": map[string]any{"colour": "#fff"}}
		}),
	} {
		if CheckHolyGraph(bad) == nil {
			t.Errorf("%s accepted", name)
		}
	}
}
