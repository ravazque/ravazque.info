// The maintenance notice's game: a snake on a square grid, one step per tick. Pure, so it is tested without a screen.
export type Dir = "up" | "down" | "left" | "right";
export type Cell = [number, number];
export type Snake = { size: number; body: Cell[]; dir: Dir; next: Dir; food: Cell; score: number; over: boolean };

const MOVE: Record<Dir, Cell> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const BACK: Record<Dir, Dir> = { up: "down", down: "up", left: "right", right: "left" };

/** A new game: three cells in the middle heading right, food somewhere free. */
export function start(size = 18, rand = Math.random): Snake {
  const y = Math.floor(size / 2), body: Cell[] = [[4, y], [3, y], [2, y]];
  return { size, body, dir: "right", next: "right", food: place(size, body, rand), score: 0, over: false };
}

/** A free cell for the food (none left: the corner, the game is won by then). */
export function place(size: number, body: Cell[], rand = Math.random): Cell {
  const free: Cell[] = [];
  for (let x = 0; x < size; x++) for (let y = 0; y < size; y++) if (!body.some(([a, b]) => a === x && b === y)) free.push([x, y]);
  return free.length ? free[Math.floor(rand() * free.length)] : [0, 0];
}

/** Turn for the next step; turning straight back is ignored (it would bite itself at once). */
export function turn(s: Snake, d: Dir): Snake {
  return d === BACK[s.dir] || s.over ? s : { ...s, next: d };
}

/** One step: the head moves, eating grows it and scores, a wall or itself ends the game. */
export function step(s: Snake, rand = Math.random): Snake {
  if (s.over) return s;
  const dir = s.next, [dx, dy] = MOVE[dir], [hx, hy] = s.body[0], head: Cell = [hx + dx, hy + dy];
  const eats = head[0] === s.food[0] && head[1] === s.food[1];
  const body = eats ? s.body : s.body.slice(0, -1);
  const out = head[0] < 0 || head[1] < 0 || head[0] >= s.size || head[1] >= s.size || body.some(([a, b]) => a === head[0] && b === head[1]);
  if (out) return { ...s, dir, over: true };
  const grown: Cell[] = [head, ...body];
  return { ...s, dir, body: grown, food: eats ? place(s.size, grown, rand) : s.food, score: s.score + (eats ? 1 : 0) };
}
