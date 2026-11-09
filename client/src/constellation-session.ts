export const CONSTELLATION_SEED_KEY = 'constellation-seed';

export interface ConstellationSessionInput {
  readonly storedSeed: string | null;
  readonly navigationType: string | undefined;
  readonly referrer: string;
  readonly origin: string;
}

export interface ConstellationSession {
  readonly playIntro: boolean;
  readonly seed: number;
}

const isSameOrigin = (url: string, origin: string): boolean => {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
};

// The pages are separate documents, so the layout survives navigation only through a seed kept for the tab:
// links within the site reuse it and skip the intro; a reload, a new tab or an external entry starts over.
export const resolveConstellationSession = (
  input: ConstellationSessionInput,
  newSeed: () => number
): ConstellationSession => {
  const stored = input.storedSeed === null || input.storedSeed === '' ? Number.NaN : Number(input.storedSeed);
  const sameSiteEntry = input.navigationType === 'back_forward'
    || (input.navigationType === 'navigate' && isSameOrigin(input.referrer, input.origin));
  return Number.isInteger(stored) && sameSiteEntry
    ? { playIntro: false, seed: stored }
    : { playIntro: true, seed: newSeed() };
};

/** Mulberry32: a small deterministic generator, so the same seed gives the same starting layout on every page. */
export const seededRandom = (seed: number): (() => number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};
