import assert from 'node:assert/strict';
import test from 'node:test';
import { nextTabIndex } from '../wwwroot/js/hero-tabs-engine.js';

test('arrow keys move between tabs and wrap around at both ends', () => {
  assert.equal(nextTabIndex(0, 4, 'ArrowRight'), 1);
  assert.equal(nextTabIndex(3, 4, 'ArrowRight'), 0);
  assert.equal(nextTabIndex(0, 4, 'ArrowLeft'), 3);
  assert.equal(nextTabIndex(2, 4, 'ArrowLeft'), 1);
});

test('Home and End jump to the first and last tab', () => {
  assert.equal(nextTabIndex(2, 4, 'Home'), 0);
  assert.equal(nextTabIndex(1, 4, 'End'), 3);
});

test('other keys, and an empty tab list, leave the selection alone', () => {
  assert.equal(nextTabIndex(1, 4, 'Enter'), null);
  assert.equal(nextTabIndex(1, 4, 'ArrowDown'), null);
  assert.equal(nextTabIndex(0, 0, 'ArrowRight'), null);
});
