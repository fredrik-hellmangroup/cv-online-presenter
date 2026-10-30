import assert from 'node:assert/strict';
import test from 'node:test';
import { themeManifest, selectCalendarLayer } from '../wwwroot/js/experience-manifest.js';
import { startExperience } from '../wwwroot/js/experience.js';

test('calendar rules select only the declared local dates', () => {
  assert.equal(selectCalendarLayer(new Date(2026, 11, 24), themeManifest.layers), 'christmas');
  assert.equal(selectCalendarLayer(new Date(2026, 11, 31), themeManifest.layers), 'new-year');
  assert.equal(selectCalendarLayer(new Date(2027, 0, 1), themeManifest.layers), 'new-year');
  assert.equal(selectCalendarLayer(new Date(2026, 9, 30), themeManifest.layers), null);
});

test('an optional engine failure leaves the next engine running', () => {
  let started = false;
  const previousWarn = console.warn;
  console.warn = () => {};
  try {
    startExperience([
      { id: 'broken', start: () => { throw new Error('effect failed'); } },
      { id: 'working', start: () => { started = true; } }
    ]);
  } finally {
    console.warn = previousWarn;
  }
  assert.equal(started, true);
});
