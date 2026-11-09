import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveConstellationSession, seededRandom } from '../wwwroot/js/constellation-session.js';

const origin = 'https://example.test';
const fresh = () => 4242;
const resolve = (overrides = {}) => resolveConstellationSession(
  { storedSeed: '7', navigationType: 'navigate', referrer: `${origin}/`, origin, ...overrides },
  fresh
);

test('following a link within the site keeps the layout and skips the intro', () => {
  assert.deepEqual(resolve(), { playIntro: false, seed: 7 });
  assert.deepEqual(resolve({ navigationType: 'back_forward', referrer: '' }), { playIntro: false, seed: 7 });
});

test('a reload, a first visit or an entry from elsewhere plays the intro with a new seed', () => {
  const expected = { playIntro: true, seed: 4242 };
  assert.deepEqual(resolve({ navigationType: 'reload' }), expected);
  assert.deepEqual(resolve({ storedSeed: null }), expected);
  assert.deepEqual(resolve({ storedSeed: 'not-a-number' }), expected);
  assert.deepEqual(resolve({ referrer: '' }), expected);
  assert.deepEqual(resolve({ referrer: 'https://other.test/' }), expected);
});

test('the seeded generator repeats for one seed and differs between seeds', () => {
  const first = seededRandom(7);
  const second = seededRandom(7);
  const values = [first(), first(), first()];
  assert.deepEqual(values, [second(), second(), second()]);
  assert.ok(values.every(value => value >= 0 && value < 1));
  assert.notDeepEqual(values, [seededRandom(8)(), seededRandom(8)(), seededRandom(8)()]);
});
