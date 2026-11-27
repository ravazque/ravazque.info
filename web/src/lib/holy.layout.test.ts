import { expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { LAYOUT, LAYOUT_RANGE, NODE_RANGE, SHAPES } from "./holy";

// the editor's numbers: the same names and ranges as the server checks (core.HolyLayout), every default inside its range
test("the drawing's numbers match the server's ranges, and each default sits inside its own", () => {
  const go = readFileSync("../server/core/holygraph.go", "utf8");
  for (const [k, [lo, hi]] of Object.entries(LAYOUT_RANGE)) {
    expect(go).toMatch(new RegExp(`"${k}": \\{${lo}, ${hi}\\}`));
    const v = LAYOUT[k as keyof typeof LAYOUT];
    expect(v >= lo && v <= hi).toBe(true);
  }
  expect(Object.keys(LAYOUT).sort()).toEqual(Object.keys(LAYOUT_RANGE).sort());
});

test("a project's size, move and shapes match what the server takes", () => {
  const go = readFileSync("../server/core/holygraph.go", "utf8");
  for (const [k, [lo, hi]] of Object.entries(NODE_RANGE)) expect(go).toMatch(new RegExp(`"${k}": \\{${lo}, ${hi}\\}`));
  for (const s of SHAPES) expect(go).toContain(`"${s}": true`);
});
