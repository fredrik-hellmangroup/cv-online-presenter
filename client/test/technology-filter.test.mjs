import assert from 'node:assert/strict';
import test from 'node:test';
import {
  countSkillAssignments,
  escapePinnedSkill,
  filterTechnologies,
  skillPinStatusText,
  togglePinnedSkill
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

test('skill pin toggles on and off and Escape clears it unless CV search is open', () => {
  assert.equal(togglePinnedSkill(null, 'Azure'), 'Azure');
  assert.equal(togglePinnedSkill('Azure', 'Azure'), null);
  assert.equal(togglePinnedSkill('Azure', '.NET'), '.NET');
  assert.equal(escapePinnedSkill('Azure', 'Escape', false), null);
  assert.equal(escapePinnedSkill('Azure', 'Escape', true), 'Azure');
  assert.equal(escapePinnedSkill('Azure', 'Enter', false), 'Azure');
  assert.equal(escapePinnedSkill(null, 'Escape', false), null);
});

test('assignment usage uses the same whole-word matching as the constellation', () => {
  assert.equal(countSkillAssignments('Azure', assignments), 2);
  assert.equal(countSkillAssignments('.NET', assignments), 2);
  assert.equal(countSkillAssignments('sql', assignments), 1);
  assert.equal(countSkillAssignments('SQL', [{ keywords: ['SQL Server', 'SQL'] }]), 1);
  assert.equal(countSkillAssignments('SQL', [{ keywords: ['MySQL'] }]), 0);
});

test('pin status reports technology usage and the cleared state', () => {
  assert.equal(skillPinStatusText('Azure', assignments), 'Markerad: Azure · används i 2 av 3 uppdrag');
  assert.equal(skillPinStatusText(null, assignments), '');
});
