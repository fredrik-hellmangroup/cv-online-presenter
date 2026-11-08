// Reports assignment keywords in the canonical CV that neither site.json "techGroups" nor the
// reviewed list in site.json "techReview.ignored" accounts for. Reporting only: it never edits content.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_KEYWORDS_HEADING = 'Nyckelord';
const usage = 'Usage: node scripts/content/report-unmapped-tech.mjs --root <dir> [--strict]';

const fold = value => value.trim().replace(/\s+/gu, ' ').toLowerCase();

// Two spellings of one technology ("Microsoft X" / "X", "X Core" / "X", "X-API" / "X API") share a key.
const overlapKey = value => fold(value)
  .replace(/^(?:microsoft|ms)\s+/u, '')
  .replace(/\s+core$/u, '')
  .replace(/-/gu, ' ');

export function extractAssignmentKeywords(source, keywordsHeading = DEFAULT_KEYWORDS_HEADING) {
  const counts = new Map();
  let inFence = false;
  let inKeywords = false;
  for (const line of source.split(/\r?\n/u)) {
    if (/^\s*(```|~~~)/u.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^(#{1,6})\s+(.*?)\s*#*\s*$/u.exec(line);
    if (heading) {
      inKeywords = heading[1].length === 4 && heading[2] === keywordsHeading;
      continue;
    }
    if (!inKeywords) continue;
    for (const raw of line.split(',')) {
      const keyword = raw.trim().replace(/^(\*\*|`)+|(\*\*|`)+$/gu, '').trim();
      if (!keyword) continue;
      const key = fold(keyword);
      const entry = counts.get(key) ?? { keyword, assignments: 0 };
      entry.assignments += 1;
      counts.set(key, entry);
    }
  }
  return counts;
}

export function analyzeTechCoverage({ keywords, techGroups, ignored }) {
  const mapped = new Set(techGroups.flatMap(group => group.items ?? []).map(fold));
  const reviewed = new Set(ignored.map(fold));
  const unmapped = [...keywords]
    .filter(([key]) => !mapped.has(key) && !reviewed.has(key))
    .map(([, entry]) => entry)
    .sort((a, b) => b.assignments - a.assignments || a.keyword.localeCompare(b.keyword, 'sv'));
  const staleIgnored = ignored.filter(item => !keywords.has(fold(item)));
  const mappedAndIgnored = ignored.filter(item => mapped.has(fold(item)));

  const spellings = new Map();
  for (const name of [...[...keywords.values()].map(entry => entry.keyword),
    ...techGroups.flatMap(group => group.items ?? []), ...ignored]) {
    const key = overlapKey(name);
    const known = spellings.get(key) ?? new Map();
    known.set(fold(name), name);
    spellings.set(key, known);
  }
  const sameTechnology = [...spellings.values()]
    .filter(known => known.size > 1)
    .map(known => [...known.values()]);

  return { unmapped, staleIgnored, mappedAndIgnored, sameTechnology };
}

function readJson(root, relativePath, optional = false) {
  const file = path.join(root, relativePath);
  if (optional && !fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function loadTechCoverageInput(root) {
  const sourceMap = readJson(root, 'content/source-map.json');
  const site = readJson(root, 'content/site.json');
  const sections = readJson(root, 'content/cv-sections.json', true);
  const source = fs.readFileSync(path.join(root, sourceMap.source), 'utf8');
  const keywords = extractAssignmentKeywords(source, sections?.headings?.projectKeywords);
  return {
    keywords,
    techGroups: site.techGroups ?? [],
    ignored: [...(site.techReview?.ignored ?? []), ...(site.techReview?.concepts ?? [])],
    hasTechGroups: Array.isArray(site.techGroups) && site.techGroups.length > 0
  };
}

export function formatReport(result, keywordCount) {
  const lines = [];
  if (result.unmapped.length > 0) {
    lines.push(`WARN: ${result.unmapped.length} of ${keywordCount} assignment keywords in the CV are neither in site.json techGroups nor reviewed:`);
    for (const { keyword, assignments } of result.unmapped) {
      lines.push(`  - ${keyword} (${assignments} ${assignments === 1 ? 'assignment' : 'assignments'})`);
    }
    lines.push('  Add each one to a techGroups group, or to techReview.ignored or techReview.concepts, in content/site.json to accept that it is left out.');
  }
  for (const names of result.sameTechnology) {
    lines.push(`WARN: possibly the same technology under different names: ${names.join(' / ')}. Pick one spelling.`);
  }
  for (const item of result.mappedAndIgnored) {
    lines.push(`WARN: '${item}' is in both techGroups and techReview; remove it from techReview.ignored or techReview.concepts.`);
  }
  for (const item of result.staleIgnored) {
    lines.push(`INFO: '${item}' is in techReview but no assignment uses it any more.`);
  }
  if (lines.length === 0) lines.push(`Tech coverage OK: all ${keywordCount} assignment keywords are mapped or reviewed.`);
  return lines.join('\n');
}

function main(args) {
  let root;
  let strict = false;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--strict') strict = true;
    else if (args[index] === '--root' && args[index + 1] && !args[index + 1].startsWith('--')) root = args[++index];
    else {
      console.error(usage);
      return 1;
    }
  }
  if (!root) {
    console.error(usage);
    return 1;
  }
  const input = loadTechCoverageInput(path.resolve(root));
  if (!input.hasTechGroups) {
    console.log('Tech coverage skipped: site.json defines no techGroups.');
    return 0;
  }
  const result = analyzeTechCoverage(input);
  console.log(formatReport(result, input.keywords.size));
  const failing = result.unmapped.length > 0 || result.sameTechnology.length > 0 || result.mappedAndIgnored.length > 0;
  return strict && failing ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
