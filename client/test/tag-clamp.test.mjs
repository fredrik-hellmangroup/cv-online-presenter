import assert from 'node:assert/strict';
import test from 'node:test';
import { moreLabel, visibleItemCount } from '../wwwroot/js/tag-clamp-engine.js';

test('tags fitting within the row limit are all visible', () => {
  assert.equal(visibleItemCount([0, 0, 30, 30, 60], 3), 5);
  assert.equal(visibleItemCount([], 3), 0);
});

test('tags beyond the row limit are cut at the first item of the next row', () => {
  assert.equal(visibleItemCount([0, 0, 30, 30, 60, 60, 90, 90, 120], 3), 6);
  assert.equal(visibleItemCount([0, 30, 60, 90], 3), 3);
});

test('hidden tags are summarised as a plus count', () => {
  assert.equal(moreLabel(7), '+7');
});
