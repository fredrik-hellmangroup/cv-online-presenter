import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countSkillAssignments,
  escapePin,
  filterTechnologies,
  pinStatusText,
  togglePin
} from '../wwwroot/js/technology-filter-engine.js';

const assignments = [
  { keywords: ['.NET', 'Azure'] },
  { keywords: ['Azure', 'SQL Server'] },
  { keywords: ['.NET'] }
];

test('technology filtering trims and ignores case, and reports filtered and total counts', () => {
  assert.deepEqual(filterTechnologies(['.NET', 'Azure', 'SQL Server'], '  AZU '), {
    matches: [false, true, false],
    visibleCount: 1,
    totalCount: 3,
    countLabel: '1 av 3',
    isEmpty: false
  });
  assert.equal(filterTechnologies(['A', 'B'], '  ').countLabel, '2 tekniker');
});

test('a no-match query returns an empty result state and zero count', () => {
  assert.deepEqual(filterTechnologies(['.NET', 'Azure'], 'kubernetes'), {
    matches: [false, false],
    visibleCount: 0,
    totalCount: 2,
    countLabel: '0 av 2',
    isEmpty: true
  });
});

test('pins toggle by kind and name, and Escape clears unless CV search is open', () => {
  const skill = { kind: 'skill', name: 'Azure', keywords: ['Azure'] };
  const group = { kind: 'group', name: 'Azure', keywords: ['Azure', 'Kubernetes'] };
  const otherSkill = { kind: 'skill', name: '.NET', keywords: ['.NET'] };
  assert.deepEqual(togglePin(null, skill), skill);
  assert.equal(togglePin(skill, skill), null);
  assert.deepEqual(togglePin(skill, otherSkill), otherSkill);
  assert.deepEqual(togglePin(skill, group), group, 'the same name in another kind is a different pin');
  assert.deepEqual(togglePin(group, skill), skill, 'a skill pin replaces a group pin');
  assert.equal(escapePin(skill, 'Escape', false), null);
  assert.equal(escapePin(skill, 'Escape', true), skill);
  assert.equal(escapePin(skill, 'Enter', false), skill);
  assert.equal(escapePin(null, 'Escape', false), null);
});

test('assignment usage uses the same whole-word matching as the constellation', () => {
  assert.equal(countSkillAssignments('Azure', assignments), 2);
  assert.equal(countSkillAssignments('.NET', assignments), 2);
  assert.equal(countSkillAssignments('sql', assignments), 1);
  assert.equal(countSkillAssignments('SQL', [{ keywords: ['SQL Server', 'SQL'] }]), 1);
  assert.equal(countSkillAssignments('SQL', [{ keywords: ['MySQL'] }]), 0);
});

test('pin status reports skill usage, group keywords, and the cleared state', () => {
  assert.equal(pinStatusText({ kind: 'skill', name: 'Azure', keywords: ['Azure'] }, assignments),
    'Markerad: Azure \u00b7 anv\u00e4nds i 2 av 3 uppdrag');
  assert.equal(pinStatusText({ kind: 'group', name: 'Moln', keywords: ['Azure', 'Kubernetes'] }, assignments),
    'Markerat omr\u00e5de: Moln \u00b7 2 tekniker: Azure, Kubernetes');
  assert.equal(pinStatusText({ kind: 'group', name: 'Data', keywords: ['SQL Server'] }, assignments),
    'Markerat omr\u00e5de: Data \u00b7 1 teknik: SQL Server');
  assert.equal(pinStatusText(null, assignments), '');
});
