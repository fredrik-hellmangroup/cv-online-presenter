export interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Vector {
  dx: number;
  dy: number;
}

// Labels are drawn centred above a node, and nodes drift a little around their home position.
export const LABEL_HEIGHT = 26;
export const LABEL_PADDING = 10;
export const WOBBLE = 9;
/** A node counts as covered when this point, just above its dot, is inside a text block or a card. */
export const PROBE_OFFSET = 6;

export const clampRange = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), Math.max(low, high));

/**
 * Shrinks the rectangles of text blocks and cards so that a node may sit partly behind their edges
 * (partly hidden is fine, completely hidden is not). Thin blocks shrink proportionally less.
 */
export const effectiveObstacles = (rects: readonly Area[], allowedOverlap: number): Area[] =>
  rects.flatMap(rect => {
    const amount = Math.min(allowedOverlap, Math.min(rect.right - rect.left, rect.bottom - rect.top) / 4);
    const inset = { left: rect.left + amount, top: rect.top + amount, right: rect.right - amount, bottom: rect.bottom - amount };
    return inset.right > inset.left && inset.bottom > inset.top ? [inset] : [];
  });

/** The shortest move that takes a point out of the rectangle it is inside, or null when it is in none. */
export const exitVector = (x: number, y: number, rects: readonly Area[]): Vector | null => {
  let best: Vector | null = null;
  let bestDistance = Infinity;
  for (const rect of rects) {
    if (x <= rect.left || x >= rect.right || y <= rect.top || y >= rect.bottom) continue;
    const options: Vector[] = [
      { dx: rect.left - x, dy: 0 },
      { dx: rect.right - x, dy: 0 },
      { dx: 0, dy: rect.top - y },
      { dx: 0, dy: rect.bottom - y }
    ];
    for (const option of options) {
      const distance = Math.abs(option.dx) + Math.abs(option.dy);
      if (distance < bestDistance) {
        best = option;
        bestDistance = distance;
      }
    }
  }
  return best;
};

/**
 * Picks a random position for a node: inside the area (the node, its label and its drift stay inside),
 * outside the given obstacles, and as far as possible from the positions that are already taken.
 * When nothing fits it returns the least bad of its tries instead of failing.
 */
export const scatterPoint = (
  area: Area,
  half: number,
  obstacles: readonly Area[],
  taken: readonly Point[],
  random: () => number = Math.random,
  minGap = 110,
  tries = 60
): Point => {
  const left = area.left + half + WOBBLE;
  const right = Math.max(left, area.right - half - WOBBLE);
  const top = area.top + LABEL_HEIGHT + WOBBLE;
  const bottom = Math.max(top, area.bottom - WOBBLE);
  let best: Point = { x: left, y: top };
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < tries; attempt++) {
    const x = left + random() * (right - left);
    const y = top + random() * (bottom - top);
    const covered = exitVector(x, y - PROBE_OFFSET, obstacles) !== null;
    const nearest = taken.reduce((shortest, point) => Math.min(shortest, Math.hypot(point.x - x, point.y - y)), Infinity);
    const score = (covered ? -1000 : 0) + Math.min(nearest, minGap);
    if (score > bestScore) {
      best = { x, y };
      bestScore = score;
      if (!covered && nearest >= minGap) break;
    }
  }
  return best;
};
