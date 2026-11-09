import assert from 'node:assert/strict';
import test from 'node:test';
import { assignClusterGroups, bubbleCollapseDeadline, clusterAreas, collapseRevealOrder, collapseRevealState, createRevealState, introPosition, introProgress, isBubbleCollapseDue, isRevealCycleComplete, poppedOut, reconcileRevealState, retainHighlightedReveals, revealNextBatch, returnRevealedItem, revealedIndices, selectVisible, settlePopout, unrevealedCount, usageCounts, visibleBudget, BUBBLE_COLLAPSE_DELAY_MS, COLLAPSE_STAGGER_MS } from '../wwwroot/js/constellation-clusters.js';

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
  assert.equal(visibleBudget({ width: 342, height: 656 }, 103, 150, 25.3), 8);
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

test('bubble reveals the next three technologies by usage order', () => {
  const ranking = [9, 3, 7, 1, 4];
  const first = revealNextBatch(createRevealState(), ranking, 3, 6);
  assert.deepEqual(revealedIndices(first), [9, 3, 7]);
  assert.equal(unrevealedCount(first, ranking), 2);
  const second = revealNextBatch(first, ranking, 3, 6);
  assert.deepEqual(revealedIndices(second), [9, 3, 7, 1, 4]);
  assert.equal(isRevealCycleComplete(second, ranking), true);
});

test('bubble rotates the oldest batch when another batch exceeds its pop-out budget', () => {
  const ranking = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  let state = createRevealState();
  state = revealNextBatch(state, ranking, 3, 6);
  state = revealNextBatch(state, ranking, 3, 6);
  assert.deepEqual(state.batches, [[0, 1, 2], [3, 4, 5]]);
  state = revealNextBatch(state, ranking, 3, 6);
  assert.deepEqual(state.batches, [[3, 4, 5], [6, 7, 8]]);
  assert.deepEqual(state.seen, ranking);
  assert.deepEqual(revealedIndices(state), [3, 4, 5, 6, 7, 8]);
  assert.equal(isRevealCycleComplete(state, ranking), true);
});

test('focus-only pop-outs reserve budget without keeping rotated manual batches visible', () => {
  const ranking = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
  let state = createRevealState();
  state = revealNextBatch(state, ranking, 3, 6);
  state = revealNextBatch(state, ranking, 3, 6);
  state = revealNextBatch(state, ranking, 3, 6, new Set([9]));
  assert.deepEqual(state.batches, [[6, 7, 8]]);
  assert.deepEqual(revealedIndices(state), [6, 7, 8]);
});

test('bubble inactivity deadline resets to four seconds and collapse returns newest items first', () => {
  assert.equal(BUBBLE_COLLAPSE_DELAY_MS, 4000);
  assert.equal(COLLAPSE_STAGGER_MS, 150);
  assert.equal(bubbleCollapseDeadline(1000), 5000);
  const resetDeadline = bubbleCollapseDeadline(2500);
  assert.equal(resetDeadline, 6500);
  assert.equal(isBubbleCollapseDue(resetDeadline, 6499), false);
  assert.equal(isBubbleCollapseDue(resetDeadline, 6500), true);

  const ranking = [0, 1, 2, 3, 4, 5];
  let state = revealNextBatch(createRevealState(), ranking, 3, 6);
  state = revealNextBatch(state, ranking, 3, 6);
  assert.deepEqual(collapseRevealOrder(state, new Set()), [5, 4, 3, 2, 1, 0]);
  const next = returnRevealedItem(state, 5);
  assert.deepEqual(revealedIndices(next), [0, 1, 2, 3, 4]);
  assert.deepEqual(next.seen, [0, 1, 2, 3, 4]);

  const held = collapseRevealState(state, new Set([1, 4]));
  assert.deepEqual(held.batches, []);
  assert.deepEqual(held.seen, []);
  assert.deepEqual(held.held, [1, 4]);
  assert.deepEqual(collapseRevealOrder(state, new Set([1, 4])), [5, 3, 2, 0]);
  assert.deepEqual(retainHighlightedReveals(held, new Set([4])), { ...held, held: [4] });
});

test('reveal state reconciles to the current hidden technologies', () => {
  const state = revealNextBatch(createRevealState(), [0, 1, 2, 3], 3, 6);
  const resized = reconcileRevealState(state, [0, 2, 3]);
  assert.deepEqual(resized.batches, [[0, 2]]);
  assert.deepEqual(resized.seen, [0, 2]);
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


test('a reveal batch never exceeds the number of available orbit slots', () => {
  const ranking = [0, 1, 2, 3, 4, 5];
  const narrow = revealNextBatch(createRevealState(), ranking, 3, 2);
  assert.deepEqual(revealedIndices(narrow), [0, 1]);
  const limited = revealNextBatch(createRevealState(), ranking, 3, 4);
  assert.deepEqual(revealedIndices(limited), [0, 1, 2]);
  const rotated = revealNextBatch(limited, ranking, 3, 4);
  assert.deepEqual(revealedIndices(rotated), [3, 4, 5]);
});
