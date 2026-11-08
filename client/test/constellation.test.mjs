import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEdges,
  matchesSkill,
  nodesMatching,
  nodesMatchingQuery,
  parseConstellationData,
  toNodes
} from '../wwwroot/js/skills.js';
import {
  LABEL_HEIGHT,
  PROBE_OFFSET,
  WOBBLE,
  clampRange,
  effectiveObstacles,
  exitVector,
  scatterPoint
} from '../wwwroot/js/constellation-layout.js';
import {
  resolveMotionState,
  shouldAnimateConstellation,
  shouldDrawConstellationLabels
} from '../wwwroot/js/constellation-engine.js';

const groups = [
  { name: 'Plattform', skills: ['.NET', 'C#', 'ASP.NET Core', 'SQL Server'] },
  { name: 'Moln', skills: ['Azure', 'Azure DevOps', 'Kubernetes'] }
];

test('keywords match skills by whole words, not by substrings', () => {
  assert.equal(matchesSkill('SQL Server', 'SQL'), true);
  assert.equal(matchesSkill('SQL Server', 'Microsoft SQL Server'), true);
  assert.equal(matchesSkill('ASP.NET Core', 'ASP.NET'), true);
  assert.equal(matchesSkill('Azure', 'Azure DevOps'), true);
  assert.equal(matchesSkill('C#', 'C#'), true);
  assert.equal(matchesSkill('Go', 'MongoDB'), false);
  assert.equal(matchesSkill('REST', 'interest'), false);
  assert.equal(matchesSkill('', 'REST'), false);
});

test('nodes are flattened in group order and matched by keyword or query', () => {
  const nodes = toNodes(groups);
  assert.deepEqual(nodes.map(node => node.name), ['.NET', 'C#', 'ASP.NET Core', 'SQL Server', 'Azure', 'Azure DevOps', 'Kubernetes']);
  assert.deepEqual([...nodesMatching(nodes, ['SQL', 'Kubernetes'])], [3, 6]);
  assert.deepEqual([...nodesMatchingQuery(nodes, 'azure')], [4, 5]);
  assert.equal(nodesMatchingQuery(nodes, '  ').size, 0);
});

test('technologies used together in two assignments get a strong edge', () => {
  const nodes = toNodes(groups);
  const edges = buildEdges(nodes, [
    { title: 'A', keywords: ['.NET', 'Kubernetes'] },
    { title: 'B', keywords: ['.NET', 'Kubernetes', 'SQL'] },
    { title: 'C', keywords: ['C#', 'Azure DevOps'] }
  ]);
  const strong = edges.filter(edge => edge.strong);
  assert.deepEqual(strong.map(edge => [edge.a, edge.b]), [[0, 6]]);
  assert.ok(edges.some(edge => !edge.strong && edge.a === 0 && edge.b === 1), 'neighbours in a group stay connected');
  assert.ok(!edges.some(edge => edge.a === 3 && edge.b === 4), 'nodes in different groups are not chained');
});

const seeded = seed => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

test('scattered nodes and their labels stay inside the safe area at any viewport size', () => {
  const skills = ['.NET', 'C#', 'ASP.NET Core', 'SQL Server', 'PostgreSQL', 'Entity Framework Core', 'REST', 'SOAP', 'MQTT',
    'RabbitMQ', 'gRPC', 'API Management', 'Azure DevOps', 'SonarCloud', 'GitHub Actions', 'Docker', 'Kubernetes', 'Helm', 'Bicep',
    'Azure Container Apps', 'AKS', 'Azure IoT Hub', 'Event Hubs', 'Cosmos DB', 'Service Fabric', 'OpenID Connect', 'Passkeys'];
  const labelHalf = name => (name.length * 7.5) / 2 + 10;

  for (const [width, height, top] of [[1440, 900, 87], [1024, 768, 87], [390, 800, 56], [320, 600, 56]]) {
    const area = { left: 24, top: top + 16, right: width - 24, bottom: height - 88 };
    const taken = [];
    for (const name of skills) {
      const half = labelHalf(name);
      const point = scatterPoint(area, half, [], taken, seeded(width + name.length));
      taken.push(point);
      const label = `${name} at ${width}x${height}`;
      assert.ok(point.x - half >= area.left, `${label} clips on the left`);
      assert.ok(point.x + half <= area.right + 0.001 || half * 2 > area.right - area.left, `${label} clips on the right`);
      assert.ok(point.y - LABEL_HEIGHT >= area.top - 0.001, `${label} hides under the header`);
      assert.ok(point.y <= area.bottom, `${label} falls below the bottom inset`);
    }
  }
});

test('different random sources give different places, so a reload does not repeat the layout', () => {
  const area = { left: 24, top: 100, right: 1256, bottom: 700 };
  const first = scatterPoint(area, 40, [], [], seeded(1));
  const second = scatterPoint(area, 40, [], [], seeded(2));
  assert.notDeepEqual(first, second);
});

test('a node is moved out of a text block by the shortest way, and left alone outside every block', () => {
  const blocks = [{ left: 100, top: 100, right: 300, bottom: 160 }];
  assert.equal(exitVector(50, 130, blocks), null);
  assert.equal(exitVector(100, 130, blocks), null, 'the edge itself is outside');
  assert.deepEqual(exitVector(120, 130, blocks), { dx: -20, dy: 0 });
  assert.deepEqual(exitVector(200, 110, blocks), { dx: 0, dy: -10 });
  assert.deepEqual(exitVector(200, 150, blocks), { dx: 0, dy: 10 });
});

test('a node may sit partly behind the edge of a block, and thin blocks keep their middle', () => {
  const [large] = effectiveObstacles([{ left: 0, top: 0, right: 400, bottom: 300 }], 14);
  assert.deepEqual(large, { left: 14, top: 14, right: 386, bottom: 286 });
  const [line] = effectiveObstacles([{ left: 0, top: 0, right: 400, bottom: 24 }], 14);
  assert.deepEqual(line, { left: 6, top: 6, right: 394, bottom: 18 });
  assert.deepEqual(effectiveObstacles([{ left: 0, top: 0, right: 8, bottom: 8 }], 14), [{ left: 2, top: 2, right: 6, bottom: 6 }]);
});

test('scattered nodes keep clear of text and cards whenever there is room', () => {
  const area = { left: 24, top: 100, right: 1256, bottom: 700 };
  const obstacles = effectiveObstacles([
    { left: 300, top: 250, right: 980, bottom: 420 },
    { left: 24, top: 450, right: 500, bottom: 690 }
  ], 14);
  const taken = [];
  for (let node = 0; node < 40; node++) {
    const point = scatterPoint(area, 40, obstacles, taken, seeded(node + 7));
    taken.push(point);
    assert.equal(exitVector(point.x, point.y - PROBE_OFFSET, obstacles), null, `node ${node} ended up behind a block`);
  }
});

test('scattering never fails, even when text covers the whole area', () => {
  const area = { left: 24, top: 100, right: 400, bottom: 400 };
  const everything = [{ left: 0, top: 0, right: 500, bottom: 500 }];
  const point = scatterPoint(area, 30, everything, [], seeded(3));
  assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
  assert.ok(point.x >= area.left && point.x <= area.right && point.y >= area.top && point.y <= area.bottom);
  assert.ok(WOBBLE > 0);
});

test('clampRange never returns a value below the lower bound', () => {
  assert.equal(clampRange(5, 10, 20), 10);
  assert.equal(clampRange(25, 10, 20), 20);
  assert.equal(clampRange(15, 10, 20), 15);
  assert.equal(clampRange(15, 10, 5), 10);
});

test('constellation data is parsed defensively', () => {
  assert.equal(parseConstellationData(undefined), null);
  assert.equal(parseConstellationData('not json'), null);
  assert.equal(parseConstellationData('{"groups":[]}'), null);
  const parsed = parseConstellationData(JSON.stringify({ groups, assignments: [{ title: 'A', keywords: ['x'] }] }));
  assert.equal(parsed?.groups.length, 2);
  assert.equal(parsed?.assignments.length, 1);
});


test('motion state prioritizes reduced motion, then a saved choice, then the narrow-screen default', () => {
  assert.equal(resolveMotionState(true, 'running', 1440), 'reduced');
  assert.equal(resolveMotionState(false, 'running', 390), 'running');
  assert.equal(resolveMotionState(false, 'paused', 1440), 'paused');
  assert.equal(resolveMotionState(false, null, 699), 'paused');
  assert.equal(resolveMotionState(false, null, 700), 'running');
});

test('only a running constellation in a visible document animates', () => {
  assert.equal(shouldAnimateConstellation('running', true), true);
  assert.equal(shouldAnimateConstellation('paused', true), false);
  assert.equal(shouldAnimateConstellation('reduced', true), false);
  assert.equal(shouldAnimateConstellation('running', false), false);
});

test('technology labels are only drawn where there is room beside the text', () => {
  for (const width of [320, 375, 390, 428, 699]) assert.equal(shouldDrawConstellationLabels(width), false, `${width}px`);
  for (const width of [700, 768, 1440]) assert.equal(shouldDrawConstellationLabels(width), true, `${width}px`);
});
