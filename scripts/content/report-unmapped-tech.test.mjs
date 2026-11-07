import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { analyzeTechCoverage, extractAssignmentKeywords, formatReport } from './report-unmapped-tech.mjs';

const script = path.join(path.dirname(fileURLToPath(import.meta.url)), 'report-unmapped-tech.mjs');

const cv = [
  '# Name', '', 'Role', '',
  '## Uppdragshistorik', '',
  '### One', '', '#### Nyckelord', '', '.NET, SQL Server, SOLID, **Perl**', '',
  '### Two', '', '#### Nyckelord', '', 'sql server, Microsoft Azure, Go', '',
  '```', '#### Nyckelord', 'Ignored in code', '```', '',
  '## Kompetensområden', '', 'Not, a, keyword, line'
].join('\n');

test('extracts keywords from #### Nyckelord blocks only and counts assignments case-insensitively', () => {
  const keywords = extractAssignmentKeywords(cv);
  assert.deepEqual([...keywords.keys()].sort(), ['.net', 'go', 'microsoft azure', 'perl', 'solid', 'sql server']);
  assert.equal(keywords.get('sql server').assignments, 2);
  assert.equal(keywords.get('perl').keyword, 'Perl');
});

test('reports only keywords that are neither mapped nor reviewed, most used first', () => {
  const result = analyzeTechCoverage({
    keywords: extractAssignmentKeywords(cv),
    techGroups: [{ name: 'Core', items: ['.NET', 'SQL Server'] }],
    ignored: ['solid', 'Gone']
  });
  assert.deepEqual(result.unmapped.map(item => item.keyword), ['Go', 'Microsoft Azure', 'Perl']);
  assert.deepEqual(result.staleIgnored, ['Gone']);
});

test('flags spelling variants of one technology and entries listed as both mapped and ignored', () => {
  const result = analyzeTechCoverage({
    keywords: new Map([['asp.net core', { keyword: 'ASP.NET Core', assignments: 1 }]]),
    techGroups: [{ name: 'Core', items: ['ASP.NET', 'Azure DevOps'] }],
    ignored: ['Azure DevOps']
  });
  assert.deepEqual(result.sameTechnology, [['ASP.NET Core', 'ASP.NET']]);
  assert.deepEqual(result.mappedAndIgnored, ['Azure DevOps']);
  assert.match(formatReport(result, 1), /same technology/u);
});

function writeContentRoot(ignored) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tech-review-'));
  fs.mkdirSync(path.join(root, 'content', 'sources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'content', 'sources', 'master-cv.md'), cv);
  fs.writeFileSync(path.join(root, 'content', 'source-map.json'),
    JSON.stringify({ source: 'content/sources/master-cv.md', techReview: { ignored } }));
  fs.writeFileSync(path.join(root, 'content', 'site.json'),
    JSON.stringify({ techGroups: [{ name: 'Core', items: ['.NET', 'SQL Server', 'Azure'] }] }));
  return root;
}

test('--strict fails only while unreviewed keywords remain', () => {
  const run = (ignored, ...extra) => {
    const root = writeContentRoot(ignored);
    try {
      return spawnSync(process.execPath, [script, '--root', root, ...extra], { encoding: 'utf8' });
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
  const open = run([], '--strict');
  assert.equal(open.status, 1);
  assert.match(open.stdout, /Microsoft Azure/u);
  assert.equal(run([], ).status, 0);
  const reviewed = run(['SOLID', 'Perl', 'Go', 'Microsoft Azure'], '--strict');
  assert.equal(reviewed.status, 1, 'Microsoft Azure also overlaps the mapped Azure');
  assert.match(reviewed.stdout, /Microsoft Azure \/ Azure|Azure \/ Microsoft Azure/u);
});
