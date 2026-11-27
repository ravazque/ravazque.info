package core

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strings"
)

// HolyLayout: the numbers of the holy graph's drawing the editor may change, each with its range (web/src/lib/holy.ts
// reads them, its own defaults when absent).
var HolyLayout = map[string][2]float64{
	"cc_node": {20, 80}, "cc_module": {10, 40}, "ring_first": {60, 400}, "ring_gap": {10, 200}, "ring_turn": {0, 6.3}, "ring_spin": {-3.2, 3.2},
	"outer_node": {16, 60}, "outer_depth": {40, 240}, "outer_leaf": {40, 200}, "piscine_node": {20, 80},
}

// HolyNode: what the editor may change of one project's drawing (moved by dx, dy from where the layout puts it, its
// size r), each with its range; HolyShapes: the shapes a project may take (web/src/lib/holy.ts NODE_RANGE, SHAPES).
var HolyNode = map[string][2]float64{"dx": {-4000, 4000}, "dy": {-4000, 4000}, "r": {8, 120}}
var HolyShapes = map[string]bool{"circle": true, "pill": true, "square": true, "diamond": true}

// CheckHolyGraph tells whether raw is a holy graph as holygraph.json holds it (the editor's output, make dev to
// production): the Piscine's rows, both tracks' seven rings, the Outer Core's roots, edges and boxes, every project they
// draw in its own catalog, layout numbers in range, and nothing about anyone.
func CheckHolyGraph(raw []byte) error {
	var g struct {
		Piscine    [][]string                   `json:"piscine"`
		CommonCore map[string][]json.RawMessage `json:"common_core"`
		Outer      struct {
			Roots []string   `json:"roots"`
			Edges [][]string `json:"edges"`
			Boxes map[string][]struct {
				Slug    string   `json:"slug"`
				Modules []string `json:"modules"`
			} `json:"boxes"`
			Parts  map[string][]string `json:"parts"`
			Groups []struct {
				Name  string   `json:"name"`
				Slugs []string `json:"slugs"`
			} `json:"groups"`
		} `json:"outer"`
		Projects map[string]struct {
			Name string `json:"name"`
		} `json:"projects"`
		Layout map[string]float64                    `json:"layout"`
		Nodes  map[string]map[string]json.RawMessage `json:"nodes"`
		Links  map[string]json.RawMessage            `json:"links"`
	}
	if err := json.Unmarshal(raw, &g); err != nil {
		return errors.New("not a holy graph (JSON)")
	}
	var any_ map[string]any
	json.Unmarshal(raw, &any_)
	var person func(x any) error
	person = func(x any) error {
		switch t := x.(type) {
		case map[string]any:
			for k, y := range t {
				if personKeys[k] {
					return fmt.Errorf("holds %q: a holy graph holds nothing about anyone", k)
				}
				if err := person(y); err != nil {
					return err
				}
			}
		case []any:
			for _, y := range t {
				if err := person(y); err != nil {
					return err
				}
			}
		}
		return nil
	}
	if err := person(any_); err != nil {
		return err
	}
	known := func(s string) error {
		if g.Projects[s].Name == "" {
			return fmt.Errorf("%q is not in its catalog", s)
		}
		return nil
	}
	var item func(x any) error
	item = func(x any) error {
		switch t := x.(type) {
		case string:
			return known(t)
		case map[string]any:
			for k, y := range t {
				if k != "alt" && k != "chain" {
					return fmt.Errorf("an item holds %q (alt or chain only)", k)
				}
				if err := item(y); err != nil {
					return err
				}
			}
		case []any:
			for _, y := range t {
				if err := item(y); err != nil {
					return err
				}
			}
		default:
			return errors.New("an item is neither a project, an alt nor a chain")
		}
		return nil
	}
	for _, track := range []string{"c", "python"} {
		rings := g.CommonCore[track]
		if len(rings) != 7 {
			return fmt.Errorf("the %s track has %d rings, not 7", track, len(rings))
		}
		for _, r := range rings {
			var v any
			json.Unmarshal(r, &v)
			if err := item(v); err != nil {
				return err
			}
		}
	}
	for _, row := range g.Piscine {
		for _, s := range row {
			if err := known(s); err != nil {
				return err
			}
		}
	}
	for _, s := range g.Outer.Roots {
		if err := known(s); err != nil {
			return err
		}
	}
	for _, e := range g.Outer.Edges {
		if len(e) != 2 {
			return errors.New("an edge is not a pair")
		}
		for _, s := range e {
			if err := known(s); err != nil {
				return err
			}
		}
	}
	for _, bs := range g.Outer.Boxes {
		for _, b := range bs {
			for _, s := range append([]string{b.Slug}, b.Modules...) {
				if err := known(s); err != nil {
					return err
				}
			}
		}
	}
	if len(g.Outer.Groups) > 100 {
		return errors.New("more than 100 groups")
	}
	for _, gr := range g.Outer.Groups {
		if n := len([]rune(strings.TrimSpace(gr.Name))); n == 0 || n > 60 {
			return fmt.Errorf("a group's name %q is empty or longer than 60", gr.Name)
		}
		for _, s := range gr.Slugs {
			if err := known(s); err != nil {
				return err
			}
		}
	}
	for k, v := range g.Layout {
		r, ok := HolyLayout[k]
		if !ok {
			return fmt.Errorf("layout has %q, which nothing reads", k)
		}
		if v < r[0] || v > r[1] {
			return fmt.Errorf("layout %s = %v is out of %v–%v", k, v, r[0], r[1])
		}
	}
	for slug, n := range g.Nodes {
		if err := known(slug); err != nil {
			return err
		}
		for k, v := range n {
			if k == "shape" {
				var shape string
				if json.Unmarshal(v, &shape) != nil || !HolyShapes[shape] {
					return fmt.Errorf("%s: shape %s is not one drawn", slug, v)
				}
				continue
			}
			r, ok := HolyNode[k]
			if !ok {
				return fmt.Errorf("%s holds %q, which nothing reads", slug, k)
			}
			var f float64
			if json.Unmarshal(v, &f) != nil || f < r[0] || f > r[1] {
				return fmt.Errorf("%s: %s = %s is out of %v–%v", slug, k, v, r[0], r[1])
			}
		}
	}
	return checkLinks(g.Links, g.Outer.Roots, g.Outer.Edges, known)
}

var linkID = regexp.MustCompile(`^l[0-9]{1,6}$`)

// checkLinks: the owner's lines from the editor, the drawing's alone (the layout and the page's branches keep to
// outer.edges). hide: structural lines not drawn, "parent>child" or ">root" (a root's from the Common Core); add: lines
// l1, l2… whose ends are each a project {node}, a point along another line {line, t} or a point {x, y}.
func checkLinks(links map[string]json.RawMessage, roots []string, edges [][]string, known func(string) error) error {
	structural := map[string]bool{}
	for _, e := range edges {
		if len(e) == 2 {
			structural[e[0]+">"+e[1]] = true
		}
	}
	for _, r := range roots {
		structural[">"+r] = true
	}
	for k := range links {
		if k != "hide" && k != "add" {
			return fmt.Errorf("links hold %q, which nothing reads", k)
		}
	}
	var hide []string
	if raw, ok := links["hide"]; ok && (json.Unmarshal(raw, &hide) != nil || len(hide) > 2000) {
		return errors.New("links.hide is not a list of lines")
	}
	for _, h := range hide {
		if !structural[h] {
			return fmt.Errorf("links.hide: %q is no line of the graph", h)
		}
	}
	var add []map[string]json.RawMessage
	if raw, ok := links["add"]; ok && (json.Unmarshal(raw, &add) != nil || len(add) > 1000) {
		return errors.New("links.add is not a list of lines")
	}
	ids := map[string]bool{}
	for _, l := range add {
		var id string
		if json.Unmarshal(l["id"], &id) != nil || !linkID.MatchString(id) || ids[id] {
			return fmt.Errorf("a line's id %s is missing, malformed or taken", l["id"])
		}
		ids[id] = true
		for k := range l {
			if k != "id" && k != "from" && k != "to" {
				return fmt.Errorf("line %s holds %q", id, k)
			}
		}
	}
	num := func(raw json.RawMessage, lo, hi float64) bool {
		var f float64
		return json.Unmarshal(raw, &f) == nil && f >= lo && f <= hi
	}
	for _, l := range add {
		for _, side := range []string{"from", "to"} {
			var end map[string]json.RawMessage
			if json.Unmarshal(l[side], &end) != nil {
				return fmt.Errorf("a line's %s is not an end", side)
			}
			switch {
			case len(end) == 1 && end["node"] != nil:
				var s string
				if json.Unmarshal(end["node"], &s) != nil {
					return errors.New("a line's project is not a slug")
				}
				if err := known(s); err != nil {
					return err
				}
			case len(end) == 2 && end["line"] != nil && end["t"] != nil:
				var ref string
				if json.Unmarshal(end["line"], &ref) != nil || !(structural[ref] || ids[ref]) {
					return fmt.Errorf("a line ends on %s, no line of the graph", end["line"])
				}
				if !num(end["t"], 0, 1) {
					return fmt.Errorf("a line ends off its line (t = %s)", end["t"])
				}
			case len(end) == 2 && end["x"] != nil && end["y"] != nil:
				if !num(end["x"], -20000, 20000) || !num(end["y"], -20000, 20000) {
					return errors.New("a line ends too far away")
				}
			default:
				return errors.New("a line's end is a project, a point along a line or a point, one of them")
			}
		}
	}
	return nil
}
