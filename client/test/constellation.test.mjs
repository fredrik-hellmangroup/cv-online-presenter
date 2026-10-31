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
import { LABEL_HEIGHT, clampRange, placeNodes } from '../wwwroot/js/constellation-layout.js';

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

test('constellation nodes and their labels stay inside the safe area at any viewport size', () => {
  const nodes = toNodes([
    { name: 'A', skills: ['.NET', 'C#', 'ASP.NET Core', 'SQL Server', 'PostgreSQL', 'Entity Framework Core'] },
    { name: 'B', skills: ['REST', 'SOAP', 'MQTT', 'RabbitMQ', 'gRPC', 'API Management'] },
    { name: 'C', skills: ['Azure DevOps', 'SonarCloud', 'GitHub Actions', 'Docker', 'Kubernetes', 'Helm', 'Bicep', 'Azure Container Apps', 'AKS'] },
    { name: 'D', skills: ['Azure IoT Hub', 'Event Hubs', 'Cosmos DB', 'Service Fabric', 'OpenID Connect', 'Passkeys'] }
  ].map(group => ({ name: group.name, skills: group.skills })));
  const sizes = [6, 6, 9, 6];
  const labelWidth = name => name.length * 7.5;

  for (const [width, height, top] of [[1440, 900, 87], [1024, 768, 87], [390, 800, 56], [320, 600, 56]]) {
    const area = { left: 24, top: top + 16, right: width - 24, bottom: height - 88 };
    const placements = placeNodes(nodes, sizes, area, labelWidth);
    placements.forEach((placement, index) => {
      const label = `${nodes[index].name} at ${width}x${height}`;
      assert.ok(placement.x - placement.half >= area.left, `${label} clips on the left`);
      assert.ok(placement.x + placement.half <= area.right + 0.001 || placement.half * 2 > area.right - area.left, `${label} clips on the right`);
      assert.ok(placement.y - LABEL_HEIGHT >= area.top - 0.001, `${label} hides under the header`);
      assert.ok(placement.y <= area.bottom, `${label} falls below the bottom inset`);
    });
  }
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
