import assert from 'node:assert/strict';
import test from 'node:test';
import { createClickCounter, createSequenceMatcher } from '../wwwroot/js/egg-triggers.js';
import { easterEggManifest } from '../wwwroot/js/experience-manifest.js';

test('five brand-mark clicks inside the window trigger the egg', () => {
  const click = createClickCounter(easterEggManifest.clickCount, easterEggManifest.clickWindowMs);
  assert.deepEqual([0, 200, 400, 600].map(click), [false, false, false, false]);
  assert.equal(click(800), true);
  assert.equal(click(1000), false);
});

test('slow clicks never trigger the egg', () => {
  const click = createClickCounter(5, 2000);
  const results = [0, 1000, 2000, 3000, 4000, 5000, 6000].map(click);
  assert.equal(results.includes(true), false);
});

test('the K-O-D sequence triggers once and ignores noise', () => {
  const press = createSequenceMatcher(easterEggManifest.keySequence);
  assert.deepEqual(['x', 'k', 'o'].map(press), [false, false, false]);
  assert.equal(press('D'), true);
  assert.equal(press('o'), false);
  assert.equal(press('d'), false);
});

test('a broken sequence does not trigger', () => {
  const press = createSequenceMatcher(['k', 'o', 'd']);
  assert.deepEqual(['k', 'd', 'o'].map(press), [false, false, false]);
});
