import assert from 'node:assert/strict';
import test from 'node:test';
import { constellationAnchorAlphaFloor, constellationEdgeStyle, routeConstellationEdges } from '../wwwroot/js/constellation-edges.js';

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
  assert.deepEqual(routed, [{ a: -1, b: 0, strong: true, fallback: false, anchor: true }]);
});

test('popped endpoints use real nodes while still-hidden partners route to the bubble', () => {
  const routed = routeConstellationEdges(
    [edge(0, 1), edge(1, 2, true), edge(2, 3)],
    Array.from({ length: 4 }, (_, group) => ({ name: `n${group}`, group })),
    Array.from({ length: 4 }, (_, x) => ({ x, y: 0 })),
    new Set([0]), new Set([1]), true
  );
  assert.deepEqual(routed, [
    { a: 0, b: 1, strong: false, fallback: false, anchor: true },
    { a: -1, b: 1, strong: true, fallback: false, anchor: false }
  ]);
});

test('an isolated technology gets a fallback edge to its nearest visible category peer', () => {
  const routed = routeConstellationEdges(
    [edge(1, 2)],
    [{ name: 'Isolated', group: 0 }, { name: 'Peer', group: 0 }, { name: 'Other category', group: 1 }],
    [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 0 }],
    new Set([0, 1, 2]), new Set(), false
  );
  assert.ok(routed.some(current => current.a === 0 && current.b === 1 && current.fallback && current.anchor));
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
  assert.ok(routed.some(current => current.anchor && (current.a === 0 || current.b === 0)));
  assert.ok(routed.some(current => current.anchor && (current.a === 1 || current.b === 1)));
  assert.ok(bubbleDegree >= 1);
});


test('anchor selection prefers the strongest drawn co-occurrence and breaks ties by distance', () => {
  const nodes = Array.from({ length: 6 }, (_, group) => ({ name: `n${group}`, group }));
  const routed = routeConstellationEdges(
    [], nodes, [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 100, y: 0 }, { x: 20, y: 0 }, { x: 101, y: 0 }, { x: 21, y: 0 }],
    new Set([0, 1, 2, 3, 4, 5]), new Set(), false, undefined, [
      { a: 0, b: 1, strong: true, weight: 4 },
      { a: 0, b: 2, strong: true, weight: 7 },
      { a: 0, b: 3, strong: true, weight: 7 },
      { a: 2, b: 4, strong: true, weight: 8 },
      { a: 3, b: 5, strong: true, weight: 8 }
    ]
  );
  assert.ok(routed.some(current => current.a === 0 && current.b === 3 && current.anchor));
  assert.ok(!routed.some(current => current.a === 0 && current.b === 2 && current.anchor));
});

test('a drawn partner is preferred over the bubble when the co-occurring partner is hidden', () => {
  const routed = routeConstellationEdges(
    [edge(0, 1, true), edge(0, 2)],
    [{ name: 'Target', group: 0 }, { name: 'Hidden partner', group: 1 }, { name: 'Drawn partner', group: 0 }],
    [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 10, y: 0 }],
    new Set([0, 2]), new Set(), true, { x: 100, y: 0 }, [edge(0, 1, true)]
  );
  assert.ok(routed.some(current => current.a === 0 && current.b === 2 && current.anchor));
  assert.ok(!routed.some(current => current.a === -1 && current.b === 0 && current.anchor));
});

test('the bubble fallback edge connects to its nearest drawn technology', () => {
  const routed = routeConstellationEdges(
    [],
    [{ name: 'Farther', group: 0 }, { name: 'Nearest', group: 0 }],
    [{ x: 100, y: 0 }, { x: 10, y: 0 }],
    new Set([0, 1]), new Set(), true,
    { x: 0, y: 0 }
  );
  assert.ok(routed.some(current => current.a === -1 && current.b === 1 && current.fallback));
});

test('anchor edges use a theme-aware median floor without exceeding highlighted edges', () => {
  const normal = constellationEdgeStyle({ strong: false, fallback: false, anchor: false }, 0);
  const fallback = constellationEdgeStyle({ strong: false, fallback: true, anchor: false }, 0);
  const highlightedNormal = constellationEdgeStyle({ strong: false, fallback: false, anchor: false }, 0.7);
  const highlightedFallback = constellationEdgeStyle({ strong: false, fallback: true, anchor: false }, 0.7);
  const darkFloor = constellationAnchorAlphaFloor(0.1, false);
  const lightFloor = constellationAnchorAlphaFloor(0.1, true);
  const medianFloor = constellationAnchorAlphaFloor(0.35, false);
  const darkAnchor = constellationEdgeStyle({ strong: false, fallback: false, anchor: true }, 0, darkFloor);
  const lightAnchor = constellationEdgeStyle({ strong: false, fallback: false, anchor: true }, 0, lightFloor);
  const medianAnchor = constellationEdgeStyle({ strong: false, fallback: false, anchor: true }, 0, medianFloor);
  assert.deepEqual(normal, { alpha: 0.03, width: 1 });
  assert.deepEqual(fallback, normal);
  assert.deepEqual(highlightedFallback, highlightedNormal);
  assert.equal(darkFloor, 0.16);
  assert.equal(lightFloor, 0.18);
  assert.equal(darkAnchor.alpha, 0.16);
  assert.equal(lightAnchor.alpha, 0.18);
  assert.equal(medianAnchor.alpha, 0.35);
  assert.ok(medianAnchor.alpha <= constellationEdgeStyle({ strong: true, fallback: false, anchor: false }, 1).alpha);
});
