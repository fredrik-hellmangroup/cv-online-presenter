/** Ambient background "dust" of the constellation: unlabelled specks that drift, twinkle and link up faintly. */
export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Radius in pixels. */
  size: number;
  /** Resting brightness, 0..1. */
  base: number;
  phase: number;
}

const NARROW_VIEWPORT = 700;
const MIN_MOTES = 20;
const MAX_MOTES = 150;
/** One speck per this many square pixels; the constellation stays calm on small screens. */
const AREA_PER_MOTE = 8500;
export const MOTE_LINK_DISTANCE = 135;

export const moteCount = (width: number, height: number): number => {
  const raw = Math.round((width * height) / AREA_PER_MOTE * (width < NARROW_VIEWPORT ? 0.55 : 1));
  return Math.min(MAX_MOTES, Math.max(MIN_MOTES, raw));
};

export const createMotes = (
  count: number,
  width: number,
  height: number,
  random: () => number = Math.random
): Mote[] =>
  Array.from({ length: count }, () => {
    const angle = random() * Math.PI * 2;
    const speed = 0.04 + random() * 0.12;
    // Now and then a brighter, larger "star" among the dust.
    const star = random() > 0.92;
    return {
      x: random() * width,
      y: random() * height,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: star ? 1.3 + random() * 0.5 : 0.6 + random() * 0.8,
      base: star ? 0.6 + random() * 0.3 : 0.3 + random() * 0.4,
      phase: random() * Math.PI * 2
    };
  });

/** Moves the motes along their heading; a mote leaving one edge comes back in from the opposite one. */
export const driftMotes = (motes: Mote[], delta: number, width: number, height: number): void => {
  for (const mote of motes) {
    mote.x += mote.vx * delta;
    mote.y += mote.vy * delta;
    if (mote.x < -2) mote.x = width + 2;
    else if (mote.x > width + 2) mote.x = -2;
    if (mote.y < -2) mote.y = height + 2;
    else if (mote.y > height + 2) mote.y = -2;
  }
};

/** Pushes motes near the pointer gently away so the dust reacts to the cursor. */
export const repelMotes = (motes: Mote[], pointerX: number, pointerY: number, radius: number): void => {
  for (const mote of motes) {
    const dx = mote.x - pointerX;
    const dy = mote.y - pointerY;
    const distance = Math.hypot(dx, dy);
    if (distance >= radius || distance < 0.1) continue;
    const push = (1 - distance / radius) * 0.06;
    mote.x += (dx / distance) * push * radius * 0.1;
    mote.y += (dy / distance) * push * radius * 0.1;
  }
};

/** Largest radius a mote can reach, kept clearly below the smallest technology node (NODE_BASE_RADIUS). */
export const MOTE_MAX_RADIUS = 2.4;

export const moteRadius = (mote: Mote, brightness: number): number =>
  Math.min(MOTE_MAX_RADIUS, mote.size * (1 + Math.min(0.35, Math.max(0, brightness - mote.base))));

/** Brightness of a mote at a moment in time: a slow twinkle around its resting value. */
export const moteBrightness = (mote: Mote, time: number): number =>
  mote.base * (0.65 + 0.35 * Math.sin(time / 900 + mote.phase));

/** Calls back for every pair of motes closer than the link distance, with how close they are (0..1). */
export const forEachMoteLink = (
  motes: readonly Mote[],
  distance: number,
  visit: (a: Mote, b: Mote, closeness: number) => void
): void => {
  for (let first = 0; first < motes.length; first++) {
    for (let second = first + 1; second < motes.length; second++) {
      const apart = Math.hypot(motes[first].x - motes[second].x, motes[first].y - motes[second].y);
      if (apart < distance) visit(motes[first], motes[second], 1 - apart / distance);
    }
  }
};
