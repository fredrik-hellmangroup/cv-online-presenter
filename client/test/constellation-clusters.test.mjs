import assert from 'node:assert/strict';
import test from 'node:test';
import { assignClusterGroups, clusterAreas, introPosition, introProgress, poppedOut, selectVisible, settlePopout, usageCounts, visibleBudget } from '../wwwroot/js/constellation-clusters.js';

const nodes = [
  { name: 'C#', group: 0 }, { name: '.NET', group: 0 }, { name: 'ASP.NET', group: 0 }, { name: 'EF Core', group: 0 },
  { name: 'TypeScript', group: 1 }, { name: 'React', group: 1 }, { name: 'CSS', group: 1 },
  { name: 'Azure', group: 2 }, { name: 'Docker', group: 2 },
  { name: 'SQL Server', group: 3 }, { name: 'PowerBI', group: 3 }
];

const usage = [14, 13, 9, 7, 11, 8, 6, 10, 4, 5, 2];

test('usage counts each assignment once for every matching technology', () => {
  const counts = usageCounts(nodes.slice(0, 3), [
    { keywords: ['C#', '.NET'] },
    { keywords: ['ASP.NET', 'C#'] },
    { keywords: ['C#'] }
  ]);
  assert.deepEqual(counts, [3, 1, 1]);
});

test('visible budget scales with usable label area and stays bounded', () => {
  assert.equal(visibleBudget({ width: 0, height: 0 }, 30), 6);
  assert.equal(visibleBudget({ width: 1392, height: 709 }, 103, 130, 30), 36);
  assert.equal(visibleBudget({ width: 342, height: 656 }, 103, 112, 25.3), 11);
  assert.equal(visibleBudget({ width: 5000, height: 3000 }, 11), 11);
  assert.equal(visibleBudget({ width: 5000, height: 3000 }, 0), 0);
});

test('category floor chooses a representative from each category before filling by usage', () => {
  assert.deepEqual(selectVisible(nodes, usage, 8), [0, 4, 7, 9, 1, 2, 5, 3]);
});


test('other-group technologies may fill remaining slots without receiving a category floor', () => {
  const mixed = [
    { name: 'Core', group: 0 }, { name: 'UI', group: 1 },
    { name: 'Other winner', group: 2, isOther: true }, { name: 'Other lower', group: 2, isOther: true }
  ];
  assert.deepEqual(selectVisible(mixed, [4, 3, 10, 2], 4), [0, 1, 2, 3]);
});

test('category floor is disabled when categories exceed half the visible budget', () => {
  const manyCategories = Array.from({ length: 5 }, (_, group) => ({ name: `n${group}`, group }));
  assert.deepEqual(selectVisible(manyCategories, [1, 9, 4, 8, 3], 8), [1, 3, 2, 4, 0]);
});

test('pop-out selects the highest-usage focused hidden nodes and counts the rest', () => {
  assert.deepEqual(poppedOut([4, 2, 7, 1], new Set([1, 2, 4]), 2), { shown: [4, 2], remaining: 1 });
});

test('intro easing and position reach the home point smoothly', () => {
  assert.equal(introProgress(100, 100, 1200), 0);
  assert.equal(introProgress(1300, 100, 1200), 1);
  assert.equal(introProgress(0, 100, 1200), 0);
  assert.deepEqual(introPosition({ x: 100, y: 80 }, { x: 20, y: 10 }, 0.5), { x: 60, y: 45 });
});


test('cluster areas partition the usable area into distinct anchor regions', () => {
  const areas = clusterAreas({ left: 10, top: 20, right: 410, bottom: 220 }, 3);
  assert.equal(areas.length, 3);
  assert.ok(areas.every(area => area.left >= 10 && area.right <= 410 && area.top >= 20 && area.bottom <= 220));
  assert.notDeepEqual(areas[0], areas[1]);
});

test('paused pop-outs settle at their target or return fully to the bubble', () => {
  assert.deepEqual(settlePopout(true, { x: 140, y: 80 }, { x: 20, y: 30 }), { x: 140, y: 80, alpha: 1 });
  assert.deepEqual(settlePopout(false, { x: 140, y: 80 }, { x: 20, y: 30 }), { x: 20, y: 30, alpha: 0 });
});


test('weighted cluster regions scale with visible membership', () => {
  const [small, large, unused] = clusterAreas({ left: 0, top: 0, right: 1000, bottom: 500 }, [1, 3, 0]);
  const smallWidth = small.right - small.left;
  const largeWidth = large.right - large.left;
  assert.ok(largeWidth > smallWidth * 2);
  assert.deepEqual(unused, { left: 0, top: 0, right: 1000, bottom: 500 });
});

test('visible Övrigt nodes are assigned across the least-loaded regular clusters', () => {
  const grouped = [
    { name: 'A', group: 0 }, { name: 'B', group: 1 }, { name: 'C', group: 1 },
    { name: 'Other one', group: 2, isOther: true }, { name: 'Other two', group: 2, isOther: true }
  ];
  const assignments = assignClusterGroups(grouped, [0, 1, 3, 4], 3);
  assert.deepEqual(assignments.slice(3), [0, 1]);
});
