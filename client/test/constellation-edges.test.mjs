import assert from 'node:assert/strict';
import test from 'node:test';
import { routeConstellationEdges } from '../wwwroot/js/constellation-edges.js';

const edge = (a, b, strong = false) => ({ a, b, strong });
const degreeCounts = (routed, nodeCount, bubbleVisible) => {
  const degrees = Array.from({ length: nodeCount }, () => 0);
  let bubbleDegree = 0;
  for (const current of routed) {
    if (current.a < 0) bubbleDegree++; else degrees[current.a]++;
    if (current.b < 0) bubbleDegree++; else degrees[current.b]++;
  }
  return { degrees, bubbleDegree: bubbleVisible ? bubbleDegree : null };
};

test('a visible node routes its hidden-only partner to the bubble', () => {
  const routed = routeConstellationEdges(
    [edge(0, 1, true)],
    [{ name: 'Visible', group: 0 }, { name: 'Hidden', group: 1 }],
    [{ x: 10, y: 10 }, { x: 20, y: 20 }],
    new Set([0]), new Set(), true
  );
  assert.deepEqual(routed, [{ a: -1, b: 0, strong: true, faint: true }]);
});

test('popped endpoints use real nodes while still-hidden partners route to the bubble', () => {
  const routed = routeConstellationEdges(
    [edge(0, 1), edge(1, 2, true), edge(2, 3)],
    Array.from({ length: 4 }, (_, group) => ({ name: `n${group}`, group })),
    Array.from({ length: 4 }, (_, x) => ({ x, y: 0 })),
    new Set([0]), new Set([1]), true
  );
  assert.deepEqual(routed, [
    { a: 0, b: 1, strong: false, faint: false },
    { a: -1, b: 1, strong: true, faint: true }
  ]);
});

test('an isolated technology gets a faint edge to its nearest visible category peer', () => {
  const routed = routeConstellationEdges(
    [edge(1, 2)],
    [{ name: 'Isolated', group: 0 }, { name: 'Peer', group: 0 }, { name: 'Other category', group: 1 }],
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 0 }],
    new Set([0, 1, 2]), new Set(), false
  );
  assert.ok(routed.some(current => current.a === 0 && current.b === 1 && current.faint));
});

test('all drawn technologies and the bubble have at least one routed edge', () => {
  const nodes = [
    { name: 'Visible', group: 0 }, { name: 'Popped', group: 0 },
    { name: 'Hidden', group: 1 }, { name: 'Isolated Other', group: 2, isOther: true }
  ];
  const routed = routeConstellationEdges(
    [edge(0, 2), edge(1, 2)],
    nodes,
    nodes.map((_, x) => ({ x: x * 20, y: 0 })),
    new Set([0]), new Set([1]), true
  );
  const { degrees, bubbleDegree } = degreeCounts(routed, nodes.length, true);
  assert.ok(degrees[0] >= 1);
  assert.ok(degrees[1] >= 1);
  assert.ok(bubbleDegree >= 1);
});


test('the bubble fallback edge connects to its nearest drawn technology', () => {
  const routed = routeConstellationEdges(
    [],
    [{ name: 'Farther', group: 0 }, { name: 'Nearest', group: 0 }],
    [{ x: 100, y: 0 }, { x: 10, y: 0 }],
    new Set([0, 1]), new Set(), true,
    { x: 0, y: 0 }
  );
  assert.ok(routed.some(current => current.a === -1 && current.b === 1 && current.faint));
});
