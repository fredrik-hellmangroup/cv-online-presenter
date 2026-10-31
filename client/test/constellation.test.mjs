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
import { hoursOf, skyPalette, toCss } from '../wwwroot/js/sky-palette.js';

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

test('constellation data is parsed defensively', () => {
  assert.equal(parseConstellationData(undefined), null);
  assert.equal(parseConstellationData('not json'), null);
  assert.equal(parseConstellationData('{"groups":[]}'), null);
  const parsed = parseConstellationData(JSON.stringify({ groups, assignments: [{ title: 'A', keywords: ['x'] }] }));
  assert.equal(parsed?.groups.length, 2);
  assert.equal(parsed?.assignments.length, 1);
});

test('the sky palette follows the time of day and wraps around midnight', () => {
  assert.deepEqual(skyPalette(0).curtain, skyPalette(24).curtain);
  assert.deepEqual(skyPalette(-1).curtain, skyPalette(23).curtain);
  assert.notDeepEqual(skyPalette(3).curtain, skyPalette(12).curtain);
  assert.equal(hoursOf(new Date(2026, 0, 1, 13, 30)), 13.5);
  assert.equal(toCss([1, 0.5, 0]), '255, 128, 0');
});
