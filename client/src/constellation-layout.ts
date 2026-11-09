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

export type LabelRect = Area;

// Labels are drawn centred above a node, and nodes drift a little around their home position.
export const LABEL_HEIGHT = 26;
export const LABEL_PADDING = 10;
export const WOBBLE = 9;
export const BUBBLE_DOT_CLEARANCE = 28;
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
export const exitVector = (x: number, y: number, rects: readonly Area[], padding = 0): Vector | null => {
  let best: Vector | null = null;
  let bestDistance = Infinity;
  for (const rect of rects) {
    if (x <= rect.left - padding || x >= rect.right + padding
      || y <= rect.top - padding || y >= rect.bottom + padding) continue;
    const options: Vector[] = [
      { dx: rect.left - padding - x, dy: 0 },
      { dx: rect.right + padding - x, dy: 0 },
      { dx: 0, dy: rect.top - padding - y },
      { dx: 0, dy: rect.bottom + padding - y }
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

export const labelRectAt = (point: Point, half: number, height = LABEL_HEIGHT): LabelRect => ({
  left: point.x - half,
  top: point.y - height,
  right: point.x + half,
  bottom: point.y
});

export const labelOverlapArea = (first: LabelRect, second: LabelRect): number =>
  Math.max(0, Math.min(first.right, second.right) - Math.max(first.left, second.left))
  * Math.max(0, Math.min(first.bottom, second.bottom) - Math.max(first.top, second.top));

/** Finds the shortest translation that takes a label rectangle out of every obstacle. */
export const labelExitVector = (
  point: Point,
  half: number,
  labelOffset: number,
  rects: readonly Area[],
  gap = 4
): Vector | null => {
  const label = labelRectAt({ x: point.x, y: point.y - labelOffset }, half);
  let best: Vector | null = null;
  let bestDistance = Infinity;
  for (const rect of rects) {
    if (labelOverlapArea(label, rect) === 0) continue;
    const left = rect.left - gap - label.right;
    const right = rect.right + gap - label.left;
    const top = rect.top - gap - label.bottom;
    const bottom = rect.bottom + gap - label.top;
    const leftDistance = Math.abs(left);
    if (leftDistance < bestDistance) { best = { dx: left, dy: 0 }; bestDistance = leftDistance; }
    const rightDistance = Math.abs(right);
    if (rightDistance < bestDistance) { best = { dx: right, dy: 0 }; bestDistance = rightDistance; }
    const topDistance = Math.abs(top);
    if (topDistance < bestDistance) { best = { dx: 0, dy: top }; bestDistance = topDistance; }
    const bottomDistance = Math.abs(bottom);
    if (bottomDistance < bestDistance) { best = { dx: 0, dy: bottom }; bestDistance = bottomDistance; }
  }
  return best;
};

export interface OrbitSlot extends Point {
  readonly radius: number;
}

const ORBIT_INNER_RADIUS = 38;
const ORBIT_RADIAL_STEP = 30;
const ORBIT_RADIUS_GAP = 8;
const ORBIT_LABEL_GAP = 2;
const ORBIT_ANGLE_COUNT = 36;
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const MAX_ORBIT_SLOTS = 12;
const MAX_MOBILE_ORBIT_SLOTS = 6;

/** Orders labels widest-first and limits work to the viewport's orbit-slot budget. */
export const orbitCandidateWidths = (area: Area, halfWidths: readonly number[]): number[] => {
  const slotLimit = area.right - area.left < 700 ? MAX_MOBILE_ORBIT_SLOTS : MAX_ORBIT_SLOTS;
  return [...halfWidths].sort((a, b) => b - a).slice(0, slotLimit);
};

/** Finds outward-spreading, on-screen label slots around a floating cluster anchor. */
export const orbitSlots = (
  area: Area,
  center: Point,
  halfWidths: readonly number[],
  obstacles: readonly Area[],
  occupiedLabels: readonly LabelRect[],
  maxRadius = (area.bottom - area.top) * 1.1
): OrbitSlot[] => {
  const taken = [...occupiedLabels];
  const slots: OrbitSlot[] = [];
  let previousRadius = 0;
  const radiusLimit = Math.max(0, maxRadius);

  const slotLimit = area.right - area.left < 700 ? MAX_MOBILE_ORBIT_SLOTS : MAX_ORBIT_SLOTS;
  for (let index = 0; index < Math.min(halfWidths.length, slotLimit); index++) {
    const half = halfWidths[index];
    const minimumRadius = Math.max(
      ORBIT_INNER_RADIUS + ORBIT_RADIAL_STEP * Math.sqrt(index),
      previousRadius + ORBIT_RADIUS_GAP
    );
    let selected: OrbitSlot | null = null;

    for (let radius = minimumRadius; radius <= radiusLimit && !selected; radius += ORBIT_RADIUS_GAP) {
      for (let attempt = 0; attempt < ORBIT_ANGLE_COUNT; attempt++) {
        const angle = index * GOLDEN_ANGLE + attempt * Math.PI * 2 / ORBIT_ANGLE_COUNT;
        const x = center.x + Math.cos(angle) * radius;
        const y = center.y + Math.sin(angle) * radius;
        if (x - half < area.left || x + half > area.right
          || y - LABEL_HEIGHT < area.top || y > area.bottom
          || exitVector(x, y - PROBE_OFFSET, obstacles) !== null) continue;

        const label = {
          left: x - half - ORBIT_LABEL_GAP,
          top: y - LABEL_HEIGHT - ORBIT_LABEL_GAP,
          right: x + half + ORBIT_LABEL_GAP,
          bottom: y + ORBIT_LABEL_GAP
        };
        if (obstacles.some(obstacle => labelOverlapArea(label, obstacle) > 0)
          || taken.some(other => labelOverlapArea(label, other) > 0)) continue;
        selected = { x, y, radius };
        break;
      }
    }

    if (!selected) break;
    slots.push(selected);
    taken.push(labelRectAt(selected, half));
    previousRadius = selected.radius;
  }
  return slots;
};

/** Finds a collision-free label point for the floating bubble, below the page header. */
export const scatterBubblePoint = (
  area: Area,
  half: number,
  headerBottom: number,
  obstacles: readonly Area[],
  occupiedLabels: readonly LabelRect[],
  occupiedPoints: readonly Point[],
  orbitHalfWidths: readonly number[],
  random: () => number = Math.random,
  tries = 200
): Point => {
  const left = Math.min(area.right - half, area.left + half + WOBBLE);
  const right = Math.max(left, area.right - half - WOBBLE);
  const top = Math.max(area.top + LABEL_HEIGHT + WOBBLE, headerBottom + LABEL_HEIGHT + 2);
  const bottom = Math.max(top, area.bottom - 15);
  let best: Point = { x: left, y: top };
  let bestScore = -Infinity;
  let bestValid = false;
  const firstBatchWidths = orbitCandidateWidths(area, orbitHalfWidths.slice(0, 3));
  const maximumBatchCapacity = firstBatchWidths.length;
  const revealWidths = orbitCandidateWidths(area, orbitHalfWidths);
  const maximumCapacity = revealWidths.length;

  for (let attempt = 0; attempt < tries; attempt++) {
    const point = {
      x: left + random() * (right - left),
      y: top + random() * (bottom - top)
    };
    const label = labelRectAt(point, half);
    let overlap = 0;
    for (const obstacle of obstacles) overlap += labelOverlapArea(label, obstacle);
    for (const other of occupiedLabels) overlap += labelOverlapArea(label, other);
    const dotY = point.y + 15;
    const dotClearance = BUBBLE_DOT_CLEARANCE;
    const nodeDotClearance = 12;
    const dotBlocked = obstacles.some(obstacle =>
      point.x + dotClearance > obstacle.left && point.x - dotClearance < obstacle.right
      && dotY + dotClearance > obstacle.top && dotY - dotClearance < obstacle.bottom
    ) || occupiedPoints.some(other => Math.hypot(point.x - other.x, dotY - other.y) < nodeDotClearance);
    const valid = !dotBlocked && overlap === 0;
    if (!valid && bestValid) continue;
    const orbitCenter = { x: point.x, y: dotY };
    const labels = [...occupiedLabels, label];
    const batchCapacity = orbitSlots(area, orbitCenter, firstBatchWidths, obstacles, labels).length;
    const capacity = orbitSlots(area, orbitCenter, revealWidths, obstacles, labels).length;
    const score = (valid ? 1_000_000 : 0) + batchCapacity * 100_000 + capacity * 1000 - overlap;
    if (score > bestScore) {
      best = point;
      bestScore = score;
      bestValid = valid;
      if (valid && batchCapacity === maximumBatchCapacity) return point;
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
  tries = 60,
  takenLabels: readonly LabelRect[] = []
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
    const label = { left: x - half, top: y - LABEL_HEIGHT, right: x + half, bottom: y };
    let overlap = 0;
    for (const obstacle of obstacles) overlap += labelOverlapArea(label, obstacle);
    for (const other of takenLabels) {
      const overlapWidth = Math.max(0, Math.min(label.right, other.right) - Math.max(label.left, other.left));
      const overlapHeight = Math.max(0, Math.min(label.bottom, other.bottom) - Math.max(label.top, other.top));
      overlap += overlapWidth * overlapHeight;
    }
    const score = (covered ? -1_000_000 : 0) + Math.min(nearest, minGap) - (overlap > 0 ? 10_000 + overlap : 0);
    if (score > bestScore) {
      best = { x, y };
      bestScore = score;
      if (!covered && overlap === 0 && nearest >= minGap) break;
    }
  }
  return best;
};
