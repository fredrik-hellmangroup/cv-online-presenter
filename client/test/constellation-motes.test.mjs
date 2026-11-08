import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOTE_LINK_DISTANCE,
  MOTE_MAX_RADIUS,
  createMotes,
  driftMotes,
  forEachMoteLink,
  moteBrightness,
  moteCount,
  moteRadius,
  repelMotes
} from '../wwwroot/js/constellation-motes.js';

const sequence = (...values) => {
  let index = 0;
  return () => values[index++ % values.length];
};

test('the amount of dust follows the screen area, is capped, and is calmer on narrow screens', () => {
  assert.ok(moteCount(1920, 1080) > moteCount(1280, 720));
  assert.equal(moteCount(10000, 10000), 150);
  assert.equal(moteCount(100, 100), 12);
  assert.ok(moteCount(600, 1200) < Math.round((600 * 1200) / 8500));
});

test('the dust thins out as the number of technologies grows, but never disappears', () => {
  assert.equal(moteCount(1440, 900, 24), 75);
  assert.ok(moteCount(1440, 900, 78) < moteCount(1440, 900, 11));
  assert.ok(moteCount(1440, 900, 11) < moteCount(1440, 900));
  assert.equal(moteCount(375, 812, 500), 12);
});

test('motes start inside the area with a small speed and a resting brightness', () => {
  const motes = createMotes(50, 800, 600);
  assert.equal(motes.length, 50);
  for (const mote of motes) {
    assert.ok(mote.x >= 0 && mote.x <= 800 && mote.y >= 0 && mote.y <= 600);
    assert.ok(Math.hypot(mote.vx, mote.vy) < 0.2);
    assert.ok(mote.base > 0 && mote.base < 1);
  }
});

test('a mote that leaves one edge re-enters from the opposite edge', () => {
  const motes = [
    { x: -5, y: 100, vx: 0, vy: 0, size: 1, base: .3, phase: 0 },
    { x: 100, y: 700, vx: 0, vy: 0, size: 1, base: .3, phase: 0 }
  ];
  driftMotes(motes, 1, 800, 600);
  assert.equal(motes[0].x, 802);
  assert.equal(motes[1].y, -2);
});

test('motes are pushed away from the pointer but not when it is far away', () => {
  const near = { x: 110, y: 100, vx: 0, vy: 0, size: 1, base: .3, phase: 0 };
  const far = { x: 900, y: 900, vx: 0, vy: 0, size: 1, base: .3, phase: 0 };
  repelMotes([near, far], 100, 100, 160);
  assert.ok(near.x > 110);
  assert.equal(far.x, 900);
});

test('brightness twinkles around the resting value and never goes negative', () => {
  const mote = { x: 0, y: 0, vx: 0, vy: 0, size: 1, base: .4, phase: 0 };
  for (let time = 0; time < 5000; time += 250) {
    const brightness = moteBrightness(mote, time);
    assert.ok(brightness >= 0.4 * 0.3 && brightness <= 0.4);
  }
});

test('dust never grows as large as the smallest technology node, however bright it gets', () => {
  const nodeBaseRadius = 4;
  for (const mote of createMotes(500, 800, 600)) {
    assert.ok(moteRadius(mote, 5) <= MOTE_MAX_RADIUS);
    assert.ok(moteRadius(mote, 5) < nodeBaseRadius);
    assert.ok(moteRadius(mote, 0) <= moteRadius(mote, 5));
  }
});

test('only motes closer than the link distance are linked, with a closeness between zero and one', () => {
  const at = x => ({ x, y: 0, vx: 0, vy: 0, size: 1, base: .3, phase: 0 });
  const links = [];
  forEachMoteLink([at(0), at(MOTE_LINK_DISTANCE / 2), at(MOTE_LINK_DISTANCE * 4)], MOTE_LINK_DISTANCE, (a, b, closeness) => links.push([a.x, b.x, closeness]));
  assert.deepEqual(links, [[0, MOTE_LINK_DISTANCE / 2, 0.5]]);
  assert.equal(createMotes(3, 10, 10, sequence(0.5)).length, 3);
});
