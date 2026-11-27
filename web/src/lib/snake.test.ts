import { expect, test } from "vitest";
import { start, step, turn } from "./snake";

test("the snake moves a cell per step, grows and scores when it eats, ignores turning straight back", () => {
  let s = start(10, () => 0);
  expect(s.body[0]).toEqual([4, 5]);
  s = { ...s, food: [5, 5] };
  s = step(s, () => 0);
  expect(s.body[0]).toEqual([5, 5]);
  expect(s.body.length).toBe(4);
  expect(s.score).toBe(1);
  s = turn(s, "left"); // straight back: ignored
  s = step(s);
  expect(s.body[0]).toEqual([6, 5]);
  s = turn(s, "up");
  s = step(s);
  expect(s.body[0]).toEqual([6, 4]);
  expect(s.body.length).toBe(4);
});

test("a wall or its own body ends the game, and nothing moves after", () => {
  let s = start(6, () => 0);
  for (let i = 0; i < 6; i++) s = step(s);
  expect(s.over).toBe(true);
  const after = step(s);
  expect(after).toBe(s);
  // a snake folded on itself, heading up: turning right puts its head on its own body
  const t = { ...start(10, () => 0), body: [[5, 5], [5, 6], [6, 6], [6, 5], [6, 4]] as [number, number][], dir: "up" as const, next: "up" as const };
  expect(step(turn(t, "right")).over).toBe(true);
  expect(step(t).over).toBe(false);
});
