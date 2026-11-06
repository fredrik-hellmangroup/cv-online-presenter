import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import MarkdownIt from 'markdown-it';
import { fileURLToPath } from 'node:url';

const SOURCE_MAP_PATH = 'content/source-map.json';
const CV_SECTIONS_PATH = 'content/cv-sections.json';
const PROVENANCE_PATH = 'content/generated-provenance.json';
const markdownParser = new MarkdownIt('commonmark', { html: true });
const TRANSACTION_PATH = '.content-generation.transaction.json';
const TRANSACTION_TEMP_PATH = `${TRANSACTION_PATH}.tmp`;
const GENERATION_LOCK_PATH = '.cv-generation.lock';
const SOURCE_PATH = 'content/sources/master-cv.md';
const PROJECT_PAGE_PATH_PATTERN = /^content\/pages\/projects\/[a-z0-9]+(?:-[a-z0-9]+)*\.md$/u;
const SERVICE_HERO_FIELDS = Object.freeze(['kicker', 'panelEyebrow', 'panelTitle']);
const PROJECT_FACT_FIELDS = Object.freeze(['period', 'role', 'industry']);
const MAX_PROJECT_ORDER = 2147483646;
const WINDOWS_RESERVED_PROJECT_SLUGS = new Set([
  'con', 'prn', 'aux', 'nul',
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`)
]);
const normalizeMappedPath = value => path.posix.normalize(value).normalize('NFC').toLowerCase().normalize('NFC');
const DEFAULT_HEADINGS = Object.freeze({
  overview: 'Översikt',
  competenceAreas: 'Kompetensområden',
  projectHistory: 'Uppdragshistorik',
  employment: 'Anställningar',
  projectResult: 'Resultat',
  projectKeywords: 'Nyckelord',
  selectedProjects: 'Utvalda uppdrag',
  projectSummary: 'Sammanfattning',
  projectResponsibilities: 'Ansvar och genomförande',
  projectTechnology: 'Teknik'
});
let PAGE_ALLOWLIST = [];
let root;
let appCommitSha;
let appVersion;
const APP_VERSION_PATTERN = /^v\d+\.\d+\.\d+$/u;
const generatorFilePath = fileURLToPath(import.meta.url);
const appRepositoryRoot = path.resolve(path.dirname(generatorFilePath), '..', '..');
const EXCLUDED_PATHS = new Set([
  'content/pages/profile.md',
  'content/pages/contact.md',
  'content/pages/demo-profile.md'
].map(normalizeMappedPath));

const normalizeText = value => value.replace(/\r\n?/g, '\n');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const readText = relativePath => normalizeText(readRepositoryFile(relativePath).toString('utf8'));
const isNonEmptySingleLine = value => typeof value === 'string' && value.trim().length > 0 &&
  !/[\r\n\v\f\u0085\u2028\u2029]/u.test(value);
const hasNonEmptySingleLineItems = value => Array.isArray(value) && value.length > 0 &&
  value.every(isNonEmptySingleLine);
const isCompetenceGroup = group => Boolean(group) && typeof group === 'object' &&
  !Array.isArray(group) && isNonEmptySingleLine(group.title) &&
  hasNonEmptySingleLineItems(group.sourceLines) &&
  Array.isArray(group.items) && group.items.length > 0 &&
  group.items.every(item => Boolean(item) && typeof item === 'object' && !Array.isArray(item) &&
    isNonEmptySingleLine(item.title) && hasNonEmptySingleLineItems(item.sourceLines));
const fail = message => {
  throw new Error(message);
};
const errorMessage = error => error instanceof Error ? error.message : String(error);

function isSymlinkOrReparsePoint(stats) {
  return stats.isSymbolicLink() ||
    (typeof stats.attributes === 'number' && (stats.attributes & 0x400) !== 0);
}

function assertSameFileIdentity(expected, actual, relativePath) {
  if (typeof expected.ino !== 'bigint' || expected.ino === 0n ||
      typeof actual.ino !== 'bigint' || actual.ino === 0n ||
      expected.dev !== actual.dev || expected.ino !== actual.ino) {
    fail(`Repository path changed during generation: ${relativePath}`);
  }
}

function readRepositoryFile(relativePath) {
  const resolved = assertNoSymlinkPath(relativePath);
  let initialStats;
  try {
    initialStats = fs.lstatSync(resolved, { bigint: true });
  } catch (error) {
    fail(`Cannot safely inspect repository path ${relativePath}: ${error.message}`);
  }
  if (isSymlinkOrReparsePoint(initialStats)) {
    fail(`Symlink or reparse point is not allowed in generated content path: ${relativePath}`);
  }
  if (!initialStats.isFile()) {
    fail(`Repository path is not a regular file: ${relativePath}`);
  }

  let descriptor;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const nonBlocking = fs.constants.O_NONBLOCK ?? 0;
    descriptor = fs.openSync(resolved, fs.constants.O_RDONLY | noFollow | nonBlocking);
    const openedStats = fs.fstatSync(descriptor, { bigint: true });
    if (!openedStats.isFile()) fail(`Repository path is not a regular file: ${relativePath}`);
    assertSameFileIdentity(initialStats, openedStats, relativePath);

    const canonicalPath = fs.realpathSync(resolved);
    const canonicalRelative = path.relative(root, canonicalPath);
    if (canonicalRelative === '..' ||
        canonicalRelative.startsWith(`..${path.sep}`) ||
        path.isAbsolute(canonicalRelative)) {
      fail(`Resolved repository path escapes canonical repository root: ${relativePath}`);
    }
    assertSameFileIdentity(openedStats, fs.statSync(canonicalPath, { bigint: true }), relativePath);
    const contents = fs.readFileSync(descriptor);
    const finalStats = fs.fstatSync(descriptor, { bigint: true });
    assertSameFileIdentity(openedStats, finalStats, relativePath);
    if (openedStats.size !== finalStats.size ||
        openedStats.mtimeNs !== finalStats.mtimeNs ||
        openedStats.ctimeNs !== finalStats.ctimeNs) {
      fail(`Repository path changed while being read: ${relativePath}`);
    }
    assertCanonicalRoot();
    return contents;
  } catch (error) {
    if (error instanceof Error && [
      'Repository path is not a regular file:',
      'Repository path changed during generation:',
      'Repository path changed while being read:',
      'Resolved repository path escapes canonical repository root:',
      'Symlink or reparse point is not allowed in generated content path:'
    ].some(prefix => error.message.startsWith(prefix))) {
      throw error;
    }
    fail(`Cannot safely read repository path ${relativePath}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readAppCommitSha() {
  let sha;
  try {
    sha = execFileSync('git', [
      '-C', appRepositoryRoot, 'rev-parse', '--verify', 'HEAD^{commit}'
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    fail(`Cannot verify the checked-out app commit SHA: ${error.message}`);
  }
  if (!/^[a-f0-9]{40}$/u.test(sha)) {
    fail('The checked-out app commit did not resolve to a full SHA-1 commit.');
  }
  return sha;
}

function verifyAppCommitSha(value) {
  if (!/^[a-f0-9]{40}$/u.test(value ?? '')) {
    fail('--app-commit-sha must be a full 40-character lowercase Git commit SHA.');
  }
  if (readAppCommitSha() !== value) {
    fail('--app-commit-sha does not match the checked-out app HEAD.');
  }
  return value;
}

function verifyAppVersion(value) {
  if (!APP_VERSION_PATTERN.test(value ?? '')) {
    fail('--app-version must be an exact release tag such as v0.1.0.');
  }
  let tagSha;
  try {
    tagSha = execFileSync('git', [
      '-C', appRepositoryRoot, 'rev-parse', '--verify', `refs/tags/${value}^{commit}`
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    fail(`The checked-out app repository has no release tag ${value}.`);
  }
  if (tagSha !== readAppCommitSha()) {
    fail('--app-version does not match the checked-out app HEAD.');
  }
  return { version: value, sha: tagSha };
}

function lockCleanupError(originalError, cleanupErrors) {
  const cleanupDetails = cleanupErrors.map(errorMessage).join('; ');
  return new Error(
    `${errorMessage(originalError)}; lock cleanup also failed: ${cleanupDetails}. ` +
    `The ${GENERATION_LOCK_PATH} file may remain. To verify and remove it safely, inspect that exact file and its PID, confirm no content-generation process is active for this workspace (for example, inspect the process returned by Get-Process -Id <pid>), then remove only that exact file with Remove-Item -LiteralPath ${GENERATION_LOCK_PATH} and rerun.`,
    { cause: originalError }
  );
}

function resolveRepositoryPath(relativePath) {
  const resolved = path.resolve(root, ...relativePath.split('/'));
  const relative = path.relative(root, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    if (!relative) return resolved;
    fail(`Repository path escapes canonical repository root: ${relativePath}`);
  }
  return resolved;
}

function assertCanonicalRoot() {
  let actualRoot;
  try {
    actualRoot = fs.realpathSync(root);
    if (fs.realpathSync(root) !== root) fail('Canonical repository root changed during generation.');
  } catch (error) {
    fail(`Cannot revalidate canonical repository root: ${error.message}`);
  }
  if (actualRoot !== root) fail('Canonical repository root changed during generation.');
}

function assertNoSymlinkPath(relativePath) {
  assertCanonicalRoot();
  const resolved = resolveRepositoryPath(relativePath);
  const relative = path.relative(root, resolved);
  let current = root;
  for (const component of relative.split(path.sep)) {
    current = path.join(current, component);
    let stats;
    try {
      stats = fs.lstatSync(current);
    } catch (error) {
      if (error.code === 'ENOENT') break;
      fail(`Cannot safely inspect repository path ${relativePath}: ${error.message}`);
    }
    if (isSymlinkOrReparsePoint(stats)) {
      fail(`Symlink is not allowed in generated content path: ${relativePath}`);
    }
    let realPath;
    try {
      realPath = fs.realpathSync(current);
    } catch (error) {
      fail(`Cannot safely resolve repository path ${relativePath}: ${error.message}`);
    }
    const realRelative = path.relative(root, realPath);
    if (realRelative === '..' || realRelative.startsWith(`..${path.sep}`) || path.isAbsolute(realRelative)) {
      fail(`Resolved repository path escapes canonical repository root: ${relativePath}`);
    }
  }
  return resolved;
}

function assertSafeGenerationPaths() {
  for (const relativePath of [
    SOURCE_MAP_PATH,
    SOURCE_PATH,
    ...PAGE_ALLOWLIST,
    PROVENANCE_PATH,
    TRANSACTION_PATH,
    TRANSACTION_TEMP_PATH,
    GENERATION_LOCK_PATH
  ]) {
    assertNoSymlinkPath(relativePath);
  }
}

function assertSafeRelativePath(relativePath) {
  if (typeof relativePath !== 'string' || relativePath.includes('\\') || path.posix.isAbsolute(relativePath) ||
      relativePath.split('/').some(part => part === '..' || part === '' || part === '.')) {
    fail(`Unsafe repository path: ${relativePath}`);
  }
  if (EXCLUDED_PATHS.has(normalizeMappedPath(relativePath))) {
    fail(`Excluded page cannot be generated: ${relativePath}`);
  }
}

function assertSafeGeneratedPagePath(relativePath) {
  assertSafeRelativePath(relativePath);
  if (!relativePath.startsWith('content/pages/') || !relativePath.endsWith('.md')) {
    fail(`Generated page path must be a Markdown file under content/pages: ${relativePath}`);
  }
}

function extractSection(source, title, level) {
  const lines = source.split('\n');
  const tokens = markdownParser.parse(source, {});
  const headings = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'heading_open' || token.level !== 0 || Number(token.tag.slice(1)) !== level) continue;
    if (tokens[index + 1]?.content === title) headings.push(token.map[0]);
  }
  if (headings.length === 0) fail(`Required source heading not found: ${'#'.repeat(level)} ${title}`);
  if (headings.length > 1) fail(`Ambiguous source section heading appears more than once: ${'#'.repeat(level)} ${title}`);

  const start = headings[0];
  let end = lines.length;
  for (const token of tokens) {
    if (token.type !== 'heading_open' || token.level !== 0 || !token.map || token.map[0] <= start) continue;
    if (Number(token.tag.slice(1)) <= level) {
      end = token.map[0];
      break;
    }
  }
  return lines.slice(start, end).join('\n').trim();
}

function extractDirectHeadingBody(source, title, level) {
  const lines = source.split('\n');
  const tokens = markdownParser.parse(source, {});
  const matches = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'heading_open' && token.level === 0 &&
        Number(token.tag.slice(1)) === level && tokens[index + 1]?.content === title) {
      matches.push(index);
    }
  }
  if (matches.length === 0) fail(`Required source heading not found: ${'#'.repeat(level)} ${title}`);
  if (matches.length > 1) {
    fail(`Ambiguous source section heading appears more than once: ${'#'.repeat(level)} ${title}`);
  }

  const heading = tokens[matches[0]];
  if (!heading.map) fail(`Cannot locate source body for heading: ${'#'.repeat(level)} ${title}`);
  const start = heading.map[1];
  let end = lines.length;
  for (let index = matches[0] + 1; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'heading_open' && token.level === 0 && token.map?.[0] > heading.map[0]) {
      end = token.map[0];
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function projectSourceHeading(page, headings) {
  const sourceParts = page.sourceSection.split('/').map(part => part.trim());
  if (sourceParts.length !== 2 || sourceParts[0] !== headings.projectHistory) {
    fail(`Project source section must follow configured hierarchy '${headings.projectHistory} / <project heading>': ${page.sourceSection}.`);
  }
  const heading = page.sourceHeading ?? sourceParts[1];
  if (heading !== sourceParts[1]) {
    fail(`Project source heading must match its declared source section: ${page.sourceSection}.`);
  }
  return heading;
}

function extractProjectSection(source, parentHeading, childHeading) {
  const parentSection = extractSection(source, parentHeading, 2);
  try {
    return extractSection(parentSection, childHeading, 3);
  } catch (error) {
    if (error instanceof Error && error.message === `Required source heading not found: ### ${childHeading}`) {
      fail(`Project heading '${childHeading}' must be under configured section '${parentHeading}'.`);
    }
    throw error;
  }
}

function info(message) {
  console.log(`INFO: ${message}`);
}

// Which master-CV sections the published CV needs (required), may omit (optional), or must keep out of the site (publish: false).
function loadCvSections(text) {
  let config;
  try {
    config = JSON.parse(text);
  } catch (error) {
    fail(`${CV_SECTIONS_PATH} is not valid JSON: ${error.message}`);
  }
  if (config?.version !== 1 || !Array.isArray(config.sections) || config.sections.length === 0) {
    fail(`${CV_SECTIONS_PATH} must define version 1 and a non-empty sections array.`);
  }
  const seen = new Set();
  for (const section of config.sections) {
    if (typeof section?.heading !== 'string' || !section.heading.trim()) {
      fail(`Every CV section in ${CV_SECTIONS_PATH} needs a heading.`);
    }
    if (typeof section.required !== 'boolean' || typeof section.publish !== 'boolean') {
      fail(`CV section '${section.heading}' must set required and publish to true or false.`);
    }
    if (seen.has(section.heading)) fail(`CV section '${section.heading}' is listed more than once in ${CV_SECTIONS_PATH}.`);
    if (section.required && !section.publish) fail(`Required CV section '${section.heading}' cannot be unpublished.`);
    seen.add(section.heading);
  }
  const configuredHeadings = Object.hasOwn(config, 'headings') ? config.headings : {};
  if (!configuredHeadings || typeof configuredHeadings !== 'object' || Array.isArray(configuredHeadings)) {
    fail(`${CV_SECTIONS_PATH}.headings must be an object.`);
  }
  for (const [key, value] of Object.entries(configuredHeadings)) {
    if (!Object.hasOwn(DEFAULT_HEADINGS, key)) fail(`Unknown heading key '${key}' in ${CV_SECTIONS_PATH}.`);
    if (typeof value !== 'string' || !value.trim() || /[\r\n\v\f\u0085\u2028\u2029]/u.test(value)) {
      fail(`Heading '${key}' in ${CV_SECTIONS_PATH} must be a non-empty single-line string.`);
    }
  }
  const headings = { ...DEFAULT_HEADINGS, ...configuredHeadings };
  const headingGroups = [
    ['overview', 'competenceAreas', 'projectHistory', 'employment'],
    ['projectResult', 'projectKeywords'],
    ['projectResult', 'projectSummary', 'projectResponsibilities', 'projectTechnology']
  ];
  for (const group of headingGroups) {
    const seen = new Map();
    for (const key of group) {
      const normalized = headings[key].normalize('NFC').trim().toLowerCase();
      if (seen.has(normalized)) {
        fail(`Structural headings '${seen.get(normalized)}' and '${key}' must be distinct.`);
      }
      seen.set(normalized, key);
    }
  }
  return { sections: config.sections, headings };
}

function countSectionHeadings(source, title, level) {
  const tokens = markdownParser.parse(source, {});
  return tokens.filter((token, index) => token.type === 'heading_open' && token.level === 0 &&
    Number(token.tag.slice(1)) === level && tokens[index + 1]?.content === title).length;
}

function validateCvSections(source, sections) {
  for (const section of sections) {
    if (section.required) {
      extractSection(source, section.heading, 2);
      continue;
    }
    const count = countSectionHeadings(source, section.heading, 2);
    if (count > 1) fail(`Ambiguous source section heading appears more than once: ## ${section.heading}`);
    if (count === 0) info(`Optional CV section is not in the source: ${section.heading}`);
  }
}

// Removes the sections marked publish: false from the published CV, wherever they appear in the source.
function removeUnpublishedCvSections(markdown, sections) {
  const hidden = new Set(sections.filter(section => !section.publish).map(section => section.heading));
  if (hidden.size === 0) return markdown;
  const tokens = markdownParser.parse(markdown, {});
  const lines = markdown.split('\n');
  const ranges = [];
  tokens.forEach((token, index) => {
    if (token.type !== 'heading_open' || token.level !== 0 || Number(token.tag.slice(1)) !== 2) return;
    if (!hidden.has(tokens[index + 1]?.content)) return;
    const start = token.map[0];
    const next = tokens.find(candidate => candidate.type === 'heading_open' && candidate.level === 0 &&
      candidate.map[0] > start && Number(candidate.tag.slice(1)) <= 2);
    ranges.push([start, next ? next.map[0] : lines.length]);
  });
  return lines.filter((_, line) => !ranges.some(([start, end]) => line >= start && line < end)).join('\n');
}

function normalizeEvidence(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function inlineVisibleText(tokens) {
  const text = [];
  const visit = children => {
    for (const token of children) {
      if (['code_inline', 'html_inline'].includes(token.type)) continue;
      if (token.type === 'text') text.push(token.content);
      else if (token.type === 'softbreak' || token.type === 'hardbreak') text.push(' ');
      else if (token.type === 'image') text.push(token.content);
      else if (token.children) visit(token.children);
    }
  };
  visit(tokens);
  return normalizeEvidence(text.join(' '));
}

function visibleMarkdownText(markdown) {
  const text = [];
  const visit = tokens => {
    for (const token of tokens) {
      if (['code_block', 'fence', 'html_block'].includes(token.type)) continue;
      if (token.type === 'inline') text.push(inlineVisibleText(token.children ?? []));
      else if (token.children) visit(token.children);
    }
  };
  visit(markdownParser.parse(markdown, {}));
  return normalizeEvidence(text.join(' '));
}

function visibleMarkdownOutput(markdown) {
  const tokens = markdownParser.parse(markdown, {});
  const output = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type === 'inline') {
      const text = inlineVisibleText(token.children ?? []);
      if (text) output.push(text);
    } else if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      const listItems = [];
      let depth = 1;
      for (index += 1; index < tokens.length && depth > 0; index += 1) {
        const item = tokens[index];
        if (item.type === 'bullet_list_open' || item.type === 'ordered_list_open') depth += 1;
        else if (item.type === 'bullet_list_close' || item.type === 'ordered_list_close') depth -= 1;
        else if (item.type === 'inline') {
          const text = inlineVisibleText(item.children ?? []);
          if (text) listItems.push(text);
        }
      }
      index -= 1;
      output.push(listItems.map((text, itemIndex) => token.type === 'ordered_list_open'
        ? `${itemIndex + 1}. ${text}` : `- ${text}`).join('\n'));
    }
  }
  return output.join('\n\n');
}

function projectEvidence(page, source, headings) {
  const heading = projectSourceHeading(page, headings);
  const section = linesOutsideCodeBlocks(extractProjectSection(source, headings.projectHistory, heading)).join('\n');
  const result = extractSection(section, headings.projectResult, 4);
  const keywords = extractSection(section, headings.projectKeywords, 4);
  const sectionLines = section.split('\n');
  const resultIndex = sectionLines.findIndex(line => line.trim() === `#### ${headings.projectResult}`);
  if (resultIndex < 0) fail(`Required source heading not found: #### ${headings.projectResult} in ${heading}.`);
  const preResult = sectionLines.slice(1, resultIndex);
  const period = preResult.map(visibleMarkdownText).find(line => /^Period:\s*\S/u.test(line));
  const role = preResult.map(visibleMarkdownText).find(line => /^Roll:\s*\S/u.test(line));
  const industry = preResult.map(visibleMarkdownText).find(line => /^Bransch:\s*\S/u.test(line));
  const publishesIndustry = page.presentation?.facts?.includes('industry') === true;
  const contentLines = preResult.filter(line => !/^\*\*(Period|Roll):\*/u.test(line) &&
    !(publishesIndustry && /^\*\*Bransch:\*/u.test(line)));
  const firstResponsibility = contentLines.findIndex(line => /^\s*[-*+]\s+/u.test(line));
  const summaryLines = firstResponsibility < 0 ? [] : contentLines.slice(0, firstResponsibility);
  const responsibilityLines = firstResponsibility < 0 ? [] : contentLines.slice(firstResponsibility);
  const visibleKeywords = visibleMarkdownText(keywords.replace(/^####\s+[^\n]+\n?/u, ''));
  const technologies = normalizeEvidence(visibleKeywords).split(',').map(value => value.trim()).filter(Boolean);
  const summary = summaryLines.join('\n');
  const responsibilities = responsibilityLines.join('\n');
  const resultBody = result.replace(/^####\s+[^\n]+\n?/u, '');
  return {
    heading,
    section,
    period: period?.match(/^Period:\s*(.+)$/u)?.[1]?.trim(),
    role: role?.match(/^Roll:\s*(.+)$/u)?.[1]?.trim(),
    industry: industry?.match(/^Bransch:\s*(.+)$/u)?.[1]?.trim(),
    summary: visibleMarkdownOutput(summary),
    summaryEvidence: visibleMarkdownOutput(summary),
    responsibilities: visibleMarkdownOutput(responsibilities),
    responsibilitiesEvidence: visibleMarkdownOutput(responsibilities),
    result: visibleMarkdownOutput(resultBody),
    resultEvidence: visibleMarkdownOutput(resultBody),
    technologies
  };
}

function sourceIdentity(source) {
  const tokens = markdownParser.parse(source, {});
  const heading = tokens[0];
  const headingContent = tokens[1];
  const roleParagraph = tokens[3];
  const roleContent = tokens[4];
  if (heading?.type !== 'heading_open' || heading.tag !== 'h1' || heading.level !== 0 ||
      heading.map?.[0] !== 0 || headingContent?.type !== 'inline' ||
      roleParagraph?.type !== 'paragraph_open' || roleContent?.type !== 'inline') {
    fail('Canonical CV must begin with a name H1 followed by a separate role paragraph.');
  }
  const name = inlineVisibleText(headingContent.children ?? []);
  const role = inlineVisibleText(roleContent.children ?? []);
  if (!name || !role) fail('Canonical CV name H1 and role paragraph must not be empty.');
  return { name, role };
}

function validateSource(source, mapping, cvSections, headings) {
  if (!source.trim()) fail('Canonical CV source is empty.');
  const identity = sourceIdentity(source);
  const cvPage = mapping.generatedPages.find(page => page.path === 'content/pages/cv.md');
  const override = cvPage.approvedCvPublicationText?.employmentLine;
  if (override) {
    const sourceLines = source.split('\n');
    const employmentSection = extractSection(source, headings.employment, 2);
    const employmentMatches = sourceLines.filter(line => line === override.source).length;
    const sectionEmploymentMatches = linesOutsideCodeBlocks(employmentSection).filter(line => line === override.source).length;
    if (employmentMatches !== 1 || sectionEmploymentMatches !== 1) {
      fail(`CV employmentLine publication override must match exactly once in source and exactly once outside code blocks in ## ${headings.employment}.`);
    }
  }
  validateCvSections(source, cvSections);
  for (const page of mapping.generatedPages) {
    if (page.sourceSection && page.sourceSection !== 'Entire source' && page.path.startsWith('content/pages/projects/')) {
      extractProjectSection(source, headings.projectHistory, projectSourceHeading(page, headings));
    }
    for (const section of page.sourceSections ?? []) extractSection(source, section, 2);
    for (const project of page.selectedProjects ?? []) {
      extractProjectSection(source, headings.projectHistory, project.section);
    }
  }
  const home = mapping.generatedPages.find(page => page.path === 'content/pages/home.md');
  const homeTitle = `${identity.name} – ${identity.role}`;
  if (home.title !== homeTitle) fail('Home hero title metadata must match the canonical CV name and role.');
  const overview = extractSection(source, headings.overview, 2);
  if (!home.heroTagline || !visibleMarkdownText(overview).includes(normalizeEvidence(home.heroTagline))) {
    fail('Home hero tagline is missing from source evidence.');
  }
  const services = mapping.generatedPages.find(page => page.path === 'content/pages/services.md');
  const competence = extractSection(source, headings.competenceAreas, 2);
  if (services.competenceGroups !== undefined) {
    mapServiceCompetenceGroups(services, source, headings);
  } else {
    const competenceLines = new Set(linesOutsideCodeBlocks(competence)
      .map(line => visibleMarkdownOutput(line).trim()).filter(Boolean));
    for (const block of services.competenceBlocks) {
      const visibleSourceLines = block.sourceLines.map(line => visibleMarkdownOutput(line).trim());
      if (!block.title || !Array.isArray(block.sourceLines) || block.sourceLines.length === 0 ||
          visibleSourceLines.some(line => !line || !competenceLines.has(line))) {
        fail(`Services competence block lacks source evidence: ${block.title ?? '(untitled)'}.`);
      }
      if (!visibleMarkdownText(competence).toLowerCase().includes(normalizeEvidence(block.title).toLowerCase())) {
        fail(`Services competence block title lacks source evidence: ${block.title}.`);
      }
    }
  }
  const visibleSource = visibleMarkdownText(source).toLowerCase();
  for (const field of SERVICE_HERO_FIELDS) {
    if (services[field] !== undefined &&
        !visibleSource.includes(normalizeEvidence(services[field]).toLowerCase())) {
      fail(`Services hero metadata lacks source evidence: ${field}.`);
    }
  }
  const projects = mapping.generatedPages.find(page => page.path === 'content/pages/projects.md');
  for (const selected of projects.selectedProjects ?? []) {
    const selectedSection = extractProjectSection(source, headings.projectHistory, selected.section);
    const visibleSection = linesOutsideCodeBlocks(selectedSection).join('\n');
    const result = extractSection(visibleSection, headings.projectResult, 4);
    if (!selected.summary || !visibleMarkdownText(result).includes(normalizeEvidence(selected.summary))) {
      fail(`Project summary lacks source evidence: ${selected.section}.`);
    }
  }
  for (const page of mapping.generatedPages.filter(item => item.type === 'project')) {
    const heading = projectSourceHeading(page, headings);
    if (page.title !== heading) fail(`Project title must exactly match its canonical source heading: ${page.path}.`);
    const evidence = projectEvidence(page, source, headings);
    for (const field of page.presentation?.facts ?? []) {
      if (!evidence[field]) fail(`Project ${field} presentation lacks source evidence: ${heading}.`);
    }
    if (!evidence.period || !evidence.role || !evidence.summaryEvidence || !evidence.responsibilitiesEvidence ||
        !evidence.resultEvidence || evidence.technologies.length === 0) {
      fail(`Project source is missing period, role, summary, responsibilities, result or technologies: ${heading}.`);
    }
    const resultSection = extractSection(evidence.section, headings.projectResult, 4);
    if (!page.summary || !visibleMarkdownText(resultSection).includes(normalizeEvidence(page.summary))) {
      fail(`Project summary lacks source evidence: ${heading}.`);
    }
  }
  const fixedTitles = new Map([
    ['content/pages/cv.md', 'CV'],
    ['content/pages/services.md', 'Kompetens'],
    ['content/pages/projects.md', 'Uppdrag']
  ]);
  for (const [pagePath, title] of fixedTitles) {
    if (mapping.generatedPages.find(page => page.path === pagePath).title !== title) {
      fail(`Fixed section title is not allowed for ${pagePath}.`);
    }
  }
  const overviewEvidence = visibleMarkdownText(overview);
  if (![cvPage.description, home.description].every(description =>
    overviewEvidence.includes(normalizeEvidence(description)))) {
    fail(`Page description lacks source evidence in ${headings.overview}.`);
  }
  if (!visibleMarkdownText(competence).includes(normalizeEvidence(services.description))) {
    fail(`Page description lacks source evidence in ${headings.competenceAreas}.`);
  }
  if (projects.description !== headings.projectHistory) {
    fail('Projects page description must match its canonical source heading.');
  }
  for (const page of mapping.generatedPages.filter(item => item.type === 'project')) {
    if (page.description !== page.summary) fail(`Project description must match its source-backed summary: ${page.path}.`);
  }
}

function linesOutsideCodeBlocks(markdown) {
  const lines = markdown.split('\n');
  const codeLines = new Set();
  for (const token of markdownParser.parse(markdown, {})) {
    if (!['code_block', 'fence'].includes(token.type) || !token.map) continue;
    for (let line = token.map[0]; line < token.map[1]; line += 1) codeLines.add(line);
  }
  return lines.filter((_, index) => !codeLines.has(index));
}

function mappedServiceSourceLines(sourceLines, sourceBody, message) {
  const evidence = new Set(linesOutsideCodeBlocks(sourceBody)
    .map(line => visibleMarkdownOutput(line).trim()).filter(Boolean));
  const nestedListEvidence = new Set();
  let listDepth = 0;
  for (const token of markdownParser.parse(sourceBody, {})) {
    if (token.type === 'bullet_list_open' || token.type === 'ordered_list_open') {
      listDepth += 1;
    } else if (token.type === 'bullet_list_close' || token.type === 'ordered_list_close') {
      listDepth -= 1;
    } else if (token.type === 'inline' && listDepth > 1) {
      const text = inlineVisibleText(token.children ?? []);
      if (text) nestedListEvidence.add(text);
    }
  }
  const rendered = sourceLines.map(line => visibleMarkdownOutput(line).trim());
  if (sourceLines.some(line => nestedListEvidence.has(visibleMarkdownText(line)))) {
    fail(`${message} A nested list item cannot be mapped independently.`);
  }
  if (rendered.some(line => !line || !evidence.has(line))) fail(message);
  return rendered;
}

function mapServiceCompetenceGroups(page, source, headings) {
  const competence = extractSection(source, headings.competenceAreas, 2);
  const seenGroups = new Set();
  return page.competenceGroups.map(group => {
    const normalizedGroupTitle = group.title.normalize('NFC').trim().toLowerCase();
    if (seenGroups.has(normalizedGroupTitle)) fail(`Duplicate services competence group: ${group.title}.`);
    seenGroups.add(normalizedGroupTitle);

    const groupSection = extractSection(competence, group.title, 3);
    const groupLines = mappedServiceSourceLines(
      group.sourceLines,
      extractDirectHeadingBody(groupSection, group.title, 3),
      `Services competence group lacks source evidence: ${group.title}.`
    );
    const seenItems = new Set();
    const items = group.items.map(item => {
      const normalizedItemTitle = item.title.normalize('NFC').trim().toLowerCase();
      if (seenItems.has(normalizedItemTitle)) {
        fail(`Duplicate services competence item in '${group.title}': ${item.title}.`);
      }
      seenItems.add(normalizedItemTitle);

      const itemSection = extractSection(groupSection, item.title, 4);
      const sourceLines = mappedServiceSourceLines(
        item.sourceLines,
        extractDirectHeadingBody(itemSection, item.title, 4),
        `Services competence item lacks source evidence: ${group.title} / ${item.title}.`
      );
      return { title: item.title, sourceLines };
    });
    return { title: group.title, sourceLines: groupLines, items };
  });
}

function validateMapping(mapping, supportedLocales) {
  if (mapping.version !== 1 || mapping.source !== SOURCE_PATH) fail('Unsupported source-map version or source path.');
  if (!Array.isArray(mapping.generatedPages) || mapping.generatedPages.length === 0) {
    fail('source-map.json must define a non-empty generatedPages array.');
  }
  const paths = mapping.generatedPages.map(page => page?.path);
  for (const pagePath of paths) assertSafeGeneratedPagePath(pagePath);
  const normalizedPaths = paths.map(normalizeMappedPath);
  if (new Set(normalizedPaths).size !== paths.length) {
    fail('Generated page paths must be unique case-insensitively.');
  }
  PAGE_ALLOWLIST = paths;
  for (const requiredPath of [
    'content/pages/cv.md', 'content/pages/home.md', 'content/pages/services.md', 'content/pages/projects.md'
  ]) {
    if (!PAGE_ALLOWLIST.includes(requiredPath)) fail(`Required generated page is missing: ${requiredPath}.`);
  }
  const editorialPagePaths = new Set([
    'content/pages/cv.md', 'content/pages/home.md', 'content/pages/services.md', 'content/pages/projects.md'
  ]);
  for (const page of mapping.generatedPages) {
    if (page.type !== 'project') continue;
    const slug = path.posix.basename(page.path, '.md');
    if (WINDOWS_RESERVED_PROJECT_SLUGS.has(slug)) {
      fail(`Project page path must not use a reserved Windows device name: ${page.path}.`);
    }
    if (!PROJECT_PAGE_PATH_PATTERN.test(page.path)) {
      fail(`Project page path must use a lowercase slug: ${page.path}.`);
    }
  }
  const cvPage = mapping.generatedPages.find(page => page.path === 'content/pages/cv.md');
  for (const page of mapping.generatedPages) {
    for (const field of ['path', 'type', 'title', 'description', 'locale', 'status']) {
      if (typeof page[field] !== 'string' || !page[field].trim()) fail(`Mapping metadata ${field} must be a non-empty string.`);
    }
    for (const field of [
      'sourceSection', 'heroTagline', 'summary', 'links', 'sourceHeading',
      ...SERVICE_HERO_FIELDS
    ]) {
      if (page[field] !== undefined && typeof page[field] !== 'string') fail(`Mapping metadata ${field} must be a string.`);
    }
    if (page.path !== 'content/pages/services.md' &&
        ['competenceBlocks', 'competenceGroups', ...SERVICE_HERO_FIELDS]
          .some(field => Object.hasOwn(page, field))) {
      fail(`Service competence and hero metadata are only allowed for content/pages/services.md: ${page.path}.`);
    }
    if (page.presentation !== undefined) {
      const presentation = page.presentation;
      if (page.type !== 'project' || !presentation || typeof presentation !== 'object' ||
          Array.isArray(presentation) || Object.keys(presentation).length === 0 ||
          Object.keys(presentation).some(field => !['order', 'facts'].includes(field))) {
        fail(`Project presentation metadata is only allowed as a non-empty object on project pages: ${page.path}.`);
      }
      if (presentation.order !== undefined &&
          (!Number.isSafeInteger(presentation.order) || presentation.order < 0 || presentation.order > MAX_PROJECT_ORDER)) {
        fail(`Project presentation order must be a non-negative integer below Int32.MaxValue: ${page.path}.`);
      }
      if (presentation.facts !== undefined &&
          (!Array.isArray(presentation.facts) || presentation.facts.length === 0 ||
            presentation.facts.some(field => !PROJECT_FACT_FIELDS.includes(field)) ||
            new Set(presentation.facts).size !== presentation.facts.length)) {
        fail(`Project presentation facts must be a non-empty unique list of supported facts: ${page.path}.`);
      }
    }
    if ((editorialPagePaths.has(page.path) && page.type !== 'page') ||
        (!editorialPagePaths.has(page.path) && page.type !== 'project')) {
      fail(`Unsupported generated page type for ${page.path}.`);
    }
    if (page.sourceSections !== undefined &&
        (!Array.isArray(page.sourceSections) || page.sourceSections.some(section => typeof section !== 'string'))) {
      fail('Mapping metadata sourceSections must be an array of strings.');
    }
    if (page.competenceBlocks !== undefined &&
        (!Array.isArray(page.competenceBlocks) || page.competenceBlocks.some(block =>
          !block || typeof block !== 'object' || Array.isArray(block) ||
          typeof block.title !== 'string' || !block.title.trim() ||
          !Array.isArray(block.sourceLines) || block.sourceLines.some(line => typeof line !== 'string')))) {
      fail('Mapping metadata competenceBlocks must contain titled blocks with string sourceLines.');
    }
    if (page.competenceGroups !== undefined &&
        (!Array.isArray(page.competenceGroups) ||
          page.competenceGroups.some(group => !isCompetenceGroup(group)))) {
      fail('Mapping metadata competenceGroups must contain titled groups and items with non-empty single-line sourceLines.');
    }
    for (const field of SERVICE_HERO_FIELDS) {
      if (page[field] !== undefined && !isNonEmptySingleLine(page[field])) {
        fail(`Mapping metadata ${field} must be a non-empty single-line string.`);
      }
    }
    if (page.selectedProjects !== undefined &&
        (!Array.isArray(page.selectedProjects) || page.selectedProjects.some(project =>
          !project || typeof project !== 'object' || Array.isArray(project) ||
          ['section', 'path', 'summary'].some(field => typeof project[field] !== 'string' || !project[field].trim())))) {
      fail('Mapping metadata selectedProjects must contain string section, path, and summary values.');
    }
    if (page.selectedProjects !== undefined) {
      const projectRoutes = new Set(mapping.generatedPages.filter(candidate => candidate.type === 'project')
        .map(candidate => `/projects/${path.posix.basename(candidate.path, '.md')}`));
      for (const project of page.selectedProjects) {
        if (!projectRoutes.has(project.path)) fail(`Project destination must be an approved internal project route: ${project.path}.`);
      }
    }
    if (!['page', 'project'].includes(page.type) ||
        !page.sourceSection && !page.sourceSections && !page.heroTagline) fail(`Incomplete mapping metadata for ${page.path}`);
    if (page.links !== undefined && (typeof page.links !== 'string' || !page.links.trim())) {
      fail('Mapping metadata links must be a non-empty string when present.');
    }
    if (!supportedLocales.has(page.locale)) fail(`Unsupported locale '${page.locale}' for ${page.path}.`);
    if (!['draft', 'published'].includes(page.status)) {
      fail(`Invalid status '${page.status}' for ${page.path}; status must be 'draft' or 'published'.`);
    }
    if (page.path !== 'content/pages/cv.md' && page.approvedCvPublicationText !== undefined) {
      fail('CV publication text is only allowed for content/pages/cv.md.');
    }
  }
  const publicationText = cvPage.approvedCvPublicationText;
  if (publicationText !== undefined) {
    if (!publicationText || typeof publicationText !== 'object' || Array.isArray(publicationText) ||
        JSON.stringify(Object.keys(publicationText).sort()) !== JSON.stringify(['employmentLine'])) {
      fail('CV publication text must define exactly the approved employment line.');
    }
    for (const [name, override] of Object.entries(publicationText)) {
      if (!override || typeof override !== 'object' || Array.isArray(override) ||
          JSON.stringify(Object.keys(override).sort()) !== JSON.stringify(['published', 'source']) ||
          typeof override.source !== 'string' || typeof override.published !== 'string' ||
          !override.source.startsWith('- ') || !override.published.startsWith('- ') ||
          /[\r\n\v\f\u0085\u2028\u2029]/u.test(override.source) ||
          /[\r\n\v\f\u0085\u2028\u2029]/u.test(override.published)) {
        fail(`Invalid CV publication text mapping: ${name}.`);
      }
    }
  }
  const home = mapping.generatedPages.find(page => page.path === 'content/pages/home.md');
  if (typeof home.heroTagline !== 'string' || !home.heroTagline.trim()) fail('Home hero metadata must include a source-backed tagline.');
  const services = mapping.generatedPages.find(page => page.path === 'content/pages/services.md');
  const hasFlatCompetencies = services.competenceBlocks !== undefined;
  const hasGroupedCompetencies = services.competenceGroups !== undefined;
  if (hasFlatCompetencies === hasGroupedCompetencies) {
    fail('Services must define exactly one of competenceBlocks or competenceGroups.');
  }
  if (hasFlatCompetencies && services.competenceBlocks.length === 0) {
    fail('Services must define competence blocks.');
  }
  if (hasGroupedCompetencies && services.competenceGroups.length === 0) {
    fail('Services must define competence groups.');
  }
  const projects = mapping.generatedPages.find(page => page.path === 'content/pages/projects.md');
  if (!Array.isArray(projects.selectedProjects) || projects.selectedProjects.length === 0 ||
      projects.selectedProjects.some(project => typeof project.summary !== 'string' || !project.summary.trim())) {
    fail('Project cards must define source-backed summaries.');
  }
  for (const page of mapping.generatedPages.filter(item => item.type === 'project')) {
    if (typeof page.summary !== 'string' || !page.summary.trim()) fail(`Project summary is required: ${page.path}.`);
  }
  const bootstrapPaths = Object.keys(mapping.bootstrapOutputSha256 ?? {}).sort();
  if (JSON.stringify(bootstrapPaths) !== JSON.stringify([...PAGE_ALLOWLIST].sort())) {
    fail('Bootstrap hashes must cover the exact generated page allowlist.');
  }
  for (const hash of Object.values(mapping.bootstrapOutputSha256)) {
    if (!/^[a-f0-9]{64}$/.test(hash)) fail('Invalid bootstrap output SHA-256 in source-map.json.');
  }
}

function yamlValue(value) {
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return JSON.stringify(value);
  if (Number.isSafeInteger(value)) return String(value);
  fail('Mapping metadata values must be strings or arrays of strings.');
}

function frontMatter(page, sourceHash, source, headings) {
  const fields = {
    title: page.title,
    description: page.description,
    locale: page.locale,
    status: page.status,
    type: page.type
  };
  for (const field of SERVICE_HERO_FIELDS) {
    if (page[field] !== undefined) fields[field] = page[field];
  }
  for (const field of ['summary', 'links']) {
    if (page[field] !== undefined) fields[field] = page[field];
  }
  if (page.type === 'project') {
    const evidence = projectEvidence(page, source, headings);
    if (page.presentation?.order !== undefined) fields.order = page.presentation.order;
    for (const fact of page.presentation?.facts ?? []) fields[fact] = evidence[fact];
    fields.technologies = evidence.technologies;
  }
  fields.source = 'sources/master-cv.md';
  if (page.sourceSection) fields.sourceSection = page.sourceSection;
  fields.sourceSha256 = sourceHash;
  return `---\n${Object.entries(fields).map(([key, value]) => `${key}: ${yamlValue(value)}`).join('\n')}\n---\n`;
}

function reflowMarkdown(markdown) {
  const output = [];
  let paragraph = [];
  let fence;
  let lastWasList = false;
  const flush = () => {
    if (paragraph.length) output.push(paragraph.join(' '));
    paragraph = [];
  };
  for (const rawLine of markdown.split('\n')) {
    const line = rawLine.trim();
    const fenceMatch = rawLine.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      output.push(rawLine);
      const closing = rawLine.match(/^ {0,3}(`+|~+)\s*$/u);
      if (closing && closing[1][0] === fence.character && closing[1].length >= fence.length) fence = undefined;
      lastWasList = false;
      continue;
    }
    if (fenceMatch && (fenceMatch[1][0] !== '`' || !fenceMatch[2].includes('`'))) {
      flush();
      if (output.length && output.at(-1) !== '') output.push('');
      output.push(rawLine);
      fence = { character: fenceMatch[1][0], length: fenceMatch[1].length };
      lastWasList = false;
      continue;
    }
    if (!line) {
      flush();
      if (output.length && output.at(-1) !== '') output.push('');
      lastWasList = false;
      continue;
    }
    if (/^#{1,6}\s+|^\*\*/u.test(line)) {
      flush();
      output.push(line);
      lastWasList = false;
    } else if (/^[-*+]\s+/u.test(line)) {
      flush();
      output.push(line);
      lastWasList = true;
    } else if (lastWasList && output.length) {
      output[output.length - 1] += ` ${line}`;
    } else {
      paragraph.push(line);
    }
  }
  flush();
  while (output.at(-1) === '') output.pop();
  return output.join('\n');
}

function pageBody(page, source, cvSections, headings) {
  if (page.path === 'content/pages/cv.md') {
    return removeUnpublishedCvSections(applyApprovedCvPublicationText(page, source), cvSections).trimEnd();
  }
  if (page.path === 'content/pages/home.md') {
    const { name, role } = sourceIdentity(source);
    return `# ${name}\n\n${role}\n\n${page.heroTagline}`;
  }
  if (page.path === 'content/pages/services.md') {
    if (page.competenceGroups !== undefined) {
      const groups = mapServiceCompetenceGroups(page, source, headings).map(group => {
        const items = group.items.map(item => `### ${item.title}\n\n${item.sourceLines.join('\n')}`);
        return [
          `## ${group.title}`,
          '',
          group.sourceLines.join('\n'),
          ...items.flatMap(item => ['', item])
        ].join('\n');
      });
      return `# ${page.title}\n\n${groups.join('\n\n')}\n\n[Läs hela CV:t](/cv)`;
    }
    const sourceLines = new Set(linesOutsideCodeBlocks(extractSection(source, headings.competenceAreas, 2))
      .map(line => visibleMarkdownOutput(line).trim()).filter(Boolean));
    const blocks = page.competenceBlocks.map(block => {
      const lines = block.sourceLines.map(line => visibleMarkdownOutput(line).trim());
      if (lines.some(line => !line || !sourceLines.has(line))) fail(`Services competence block lacks source evidence: ${block.title}.`);
      return `## ${block.title}\n\n${lines.join('\n')}`;
    });
    return `# ${page.title}\n\n${blocks.join('\n\n')}\n\n[Läs hela CV:t](/cv)`;
  }
  if (page.path === 'content/pages/projects.md') {
    const selected = page.selectedProjects.map(project => {
      const section = extractProjectSection(source, headings.projectHistory, project.section);
      const heading = section.match(/^###\s+(.+)$/m)?.[1];
      if (!heading) fail(`Project section has no title: ${project.section}`);
      return `- [${heading}](${project.path})\n  ${project.summary}`;
    });
    return `# ${page.title}\n\n## ${headings.selectedProjects}\n\n${selected.join('\n')}`;
  }
  const project = projectEvidence(page, source, headings);
  const presentationFacts = new Set(page.presentation?.facts ?? []);
  const bodyFacts = [
    ...(!presentationFacts.has('period') ? [`**Period:** ${project.period}`] : []),
    ...(!presentationFacts.has('role') ? [`**Roll:** ${project.role}`] : [])
  ];
  const output = [
    `# ${page.title}`,
    '',
    ...bodyFacts,
    ...(bodyFacts.length > 0 ? [''] : []),
    `## ${headings.projectSummary}`,
    '',
    project.summary,
    '',
    `## ${headings.projectResponsibilities}`,
    '',
    project.responsibilities,
    '',
    `## ${headings.projectResult}`,
    '',
    project.result,
    '',
    `## ${headings.projectTechnology}`,
    '',
    project.technologies.map(technology => `- ${technology}`).join('\n'),
    '',
    '[Till alla uppdrag](/projects) · [Fullständigt CV](/cv)'
  ];
  return output.join('\n');
}

function countMarkdownH1s(markdown) {
  const tokens = markdownParser.parse(markdown, {});
  const visit = children => {
    for (const token of children) {
      if (['html_inline', 'html_block'].includes(token.type)) {
        fail('Raw HTML is not allowed in Markdown source.');
      }
      if (token.children) visit(token.children);
    }
  };
  visit(tokens);
  return tokens.filter(token => token.type === 'heading_open' && token.tag === 'h1').length;
}

function validateGeneratedHeadings(outputs, mapping) {
  const statusByPath = new Map(mapping.generatedPages.map(page => [page.path, page.status]));
  for (const [relativePath, markdown] of outputs) {
    if (statusByPath.get(relativePath) !== 'published') continue;
    const body = markdown.replace(/^---\n[\s\S]*?\n---\n?/u, '');
    const count = countMarkdownH1s(body);
    if (count !== 1) fail(`Published page must contain exactly one Markdown H1: ${relativePath} (found ${count}).`);
  }
}

function applyApprovedCvPublicationText(page, source) {
  if (page.path !== 'content/pages/cv.md' || !page.approvedCvPublicationText) return source;
  let published = source;
  for (const [name, override] of Object.entries(page.approvedCvPublicationText)) {
    const lines = published.split('\n');
    const matches = lines.flatMap((line, index) => line === override.source ? [index] : []);
    if (matches.length !== 1) fail(`CV ${name} publication override must match exactly one source line.`);
    lines[matches[0]] = override.published;
    published = lines.join('\n');
  }
  return published;
}

function generate(mapping, source, sourceHash, cvSections, headings) {
  const renderableCvSource = source.replace(/[ \t]+$/gm, whitespace => whitespace.length >= 2 ? '\\' : '');
  const outputs = new Map();
  for (const page of mapping.generatedPages) {
    const bodySource = page.path === 'content/pages/cv.md' ? renderableCvSource : source;
    outputs.set(page.path, `${frontMatter(page, sourceHash, source, headings)}\n${pageBody(page, bodySource, cvSections, headings).trim()}\n`);
  }
  return outputs;
}

function hashOutputs(outputs) {
  return Object.fromEntries([...outputs].map(([relativePath, content]) => [relativePath, sha256(content)]));
}

function load() {
  const mappingText = readText(SOURCE_MAP_PATH);
  const mapping = JSON.parse(mappingText);
  const siteSettings = JSON.parse(readText('content/site.json'));
  if (!Array.isArray(siteSettings.supportedLocales) ||
      siteSettings.supportedLocales.some(locale => typeof locale !== 'string' || !locale.trim())) {
    fail('content/site.json must define supportedLocales as non-empty strings.');
  }
  const cvSectionsText = readText(CV_SECTIONS_PATH);
  const { sections: cvSections, headings } = loadCvSections(cvSectionsText);
  validateMapping(mapping, new Set(siteSettings.supportedLocales));
  assertSafeGenerationPaths();
  const source = readText(mapping.source);
  validateSource(source, mapping, cvSections, headings);
  const sourceHash = sha256(source);
  const generatorHash = sha256(normalizeText(fs.readFileSync(generatorFilePath, 'utf8')));
  const mappingHash = sha256(mappingText);
  const outputs = generate(mapping, source, sourceHash, cvSections, headings);
  validateGeneratedHeadings(outputs, mapping);
  const outputHashes = hashOutputs(outputs);
  const provenance = {
    version: 1,
    source: mapping.source,
    sourceSha256: sourceHash,
    sourceMap: SOURCE_MAP_PATH,
    sourceMapSha256: mappingHash,
    cvSections: CV_SECTIONS_PATH,
    cvSectionsSha256: sha256(cvSectionsText),
    generator: 'scripts/content/generate-content.mjs',
    generatorSha256: generatorHash,
    generatedPages: PAGE_ALLOWLIST,
    outputSha256: outputHashes
  };
  if (appCommitSha !== undefined) provenance.appCommitSha = appCommitSha;
  if (appVersion !== undefined) provenance.appVersion = appVersion;
  provenance.provenanceSha256 = sha256(JSON.stringify(provenance));
  return { mapping, outputs, provenance, source };
}

function readProvenance() {
  const manifestPath = assertNoSymlinkPath(PROVENANCE_PATH);
  if (!fs.existsSync(manifestPath)) return undefined;
  try {
    const provenance = JSON.parse(readText(PROVENANCE_PATH));
    const { provenanceSha256, ...unsigned } = provenance;
    if (!/^[a-f0-9]{64}$/.test(provenanceSha256 ?? '') ||
        provenanceSha256 !== sha256(JSON.stringify(unsigned))) {
      fail('Generated provenance was modified or has no valid integrity hash.');
    }
    if (Object.hasOwn(provenance, 'appCommitSha') &&
        !/^[a-f0-9]{40}$/u.test(provenance.appCommitSha ?? '')) {
      fail('Generated provenance has an invalid app commit SHA.');
    }
    if (Object.hasOwn(provenance, 'appVersion') &&
        !APP_VERSION_PATTERN.test(provenance.appVersion ?? '')) {
      fail('Generated provenance has an invalid app version.');
    }
    return provenance;
  } catch (error) {
    fail(`Cannot trust existing generated provenance: ${error.message}`);
  }
}

function verifyBootstrapPage(mapping, relativePath) {
  const target = assertNoSymlinkPath(relativePath);
  if (!fs.existsSync(target)) fail(`Bootstrap output missing: ${relativePath}`);
  const actual = sha256(normalizeText(readRepositoryFile(relativePath).toString('utf8')));
  if (actual !== mapping.bootstrapOutputSha256[relativePath]) {
    fail(`Bootstrap output differs from recorded baseline; refusing overwrite: ${relativePath}`);
  }
}

function verifyBootstrap(mapping, outputs) {
  assertSafeGenerationPaths();
  for (const relativePath of PAGE_ALLOWLIST) verifyBootstrapPage(mapping, relativePath);
  if (!outputs.size) fail('No pages were generated.');
}

function verifyPreviousOutputs(previous) {
  assertSafeGenerationPaths();
  if (!previous || previous.version !== 1 || !previous.outputSha256 ||
      !Array.isArray(previous.generatedPages) || previous.generatedPages.length === 0) {
    fail('Existing generated provenance is invalid; refusing overwrite.');
  }
  const previousPaths = previous.generatedPages;
  for (const relativePath of previousPaths) assertSafeGeneratedPagePath(relativePath);
  if (new Set(previousPaths).size !== previousPaths.length ||
      JSON.stringify(Object.keys(previous.outputSha256)) !== JSON.stringify(previousPaths)) {
    fail('Existing generated provenance does not cover its exact output page list; refusing overwrite.');
  }
  if (previousPaths.some(relativePath => !PAGE_ALLOWLIST.includes(relativePath))) {
    fail('Mapped pages cannot be removed while generated outputs are managed; refusing overwrite.');
  }
  for (const relativePath of previousPaths) {
    const expected = previous.outputSha256[relativePath];
    if (!/^[a-f0-9]{64}$/.test(expected ?? '')) {
      fail(`Generated provenance has no valid hash for ${relativePath}; refusing overwrite.`);
    }
    const target = assertNoSymlinkPath(relativePath);
    if (!fs.existsSync(target) ||
        sha256(normalizeText(readRepositoryFile(relativePath).toString('utf8'))) !== expected) {
      fail(`Generated output was manually changed; refusing overwrite: ${relativePath}`);
    }
  }
}
function checkOutputs(outputs, provenance, expectedProvenance) {
  assertSafeGenerationPaths();
  if (fs.existsSync(assertNoSymlinkPath(TRANSACTION_PATH))) {
    fail(`Pending content-generation transaction journal found (${TRANSACTION_PATH}); run npm run content:generate to recover it before checking.`);
  }
  if (!provenance) fail('Generated provenance is missing; run npm run content:generate.');
  if (provenance.appCommitSha !== expectedProvenance.appCommitSha) {
    fail('Generated provenance app commit SHA does not match the requested app commit SHA; pass --app-commit-sha for the verified checkout.');
  }
      if (provenance.appVersion !== expectedProvenance.appVersion) {
        fail('Generated provenance app version does not match the requested app version; pass --app-version for the verified release tag.');
      }
  if (JSON.stringify(provenance.generatedPages) !== JSON.stringify(PAGE_ALLOWLIST) ||
      JSON.stringify(Object.keys(provenance.outputSha256 ?? {})) !== JSON.stringify(PAGE_ALLOWLIST)) {
    fail('Generated provenance does not cover the exact output allowlist.');
  }
  for (const [relativePath, expectedContent] of outputs) {
    const target = assertNoSymlinkPath(relativePath);
    if (!fs.existsSync(target)) fail(`Generated output is missing: ${relativePath}`);
    const actual = normalizeText(readRepositoryFile(relativePath).toString('utf8'));
    if (sha256(actual) !== provenance.outputSha256?.[relativePath] || actual !== expectedContent) {
      fail(`Generated output is stale or modified: ${relativePath}`);
    }
  }
  const actual = readProvenance();
  if (JSON.stringify(actual) !== JSON.stringify(provenance)) fail('Generated provenance is stale.');
  assertInputsUnchanged(provenance);
  console.log(`Verified ${outputs.size} generated page(s), source/map/generator hashes and provenance.`);
}

function syncDirectory(directory) {
  let descriptor;
  try {
    descriptor = fs.openSync(directory, 'r');
    fs.fsyncSync(descriptor);
  } catch (error) {
    const unsupportedDirectorySync =
      ['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'].includes(error.code) ||
      // Windows reports EPERM when directory handles cannot be opened for syncing.
      (process.platform === 'win32' && error.code === 'EPERM');
    // Ignore only known unsupported directory-sync errors; other I/O errors must surface.
    if (!unsupportedDirectorySync) throw error;
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function expectedTargetState(relativePath, expectedContent) {
  const target = assertNoSymlinkPath(relativePath);
  const exists = fs.existsSync(target);
  if (expectedContent === undefined) {
    if (exists) fail(`Repository target changed during generation: ${relativePath}`);
  } else if (!exists || !readRepositoryFile(relativePath).equals(expectedContent)) {
    fail(`Repository target changed during generation: ${relativePath}`);
  }
  return target;
}

function stagedSiblingPath(relativePath) {
  const directory = path.posix.dirname(relativePath);
  const basename = path.posix.basename(relativePath);
  const name = `${basename}.content-generation-${process.pid}-${randomUUID()}.tmp`;
  return directory === '.' ? name : `${directory}/${name}`;
}

function validateStagedSiblingPath(temporaryRelativePath, relativePath) {
  assertSafeRelativePath(temporaryRelativePath);
  const expectedDirectory = path.posix.dirname(relativePath);
  const expectedBasename = path.posix.basename(relativePath);
  const prefix = `${expectedBasename}.content-generation-`;
  const temporaryBasename = path.posix.basename(temporaryRelativePath);
  if (path.posix.dirname(temporaryRelativePath) !== expectedDirectory ||
      !temporaryBasename.startsWith(prefix) ||
      !/^\d+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/
        .test(temporaryBasename.slice(prefix.length))) {
    fail(`Invalid staged content path for ${relativePath}; refusing to modify it.`);
  }
}

function removeStagedTemporary(temporaryRelativePath, relativePath) {
  validateStagedSiblingPath(temporaryRelativePath, relativePath);
  const temporary = assertNoSymlinkPath(temporaryRelativePath);
  let stats;
  try {
    stats = fs.lstatSync(temporary);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    fail(`Cannot safely inspect staged content path ${temporaryRelativePath}: ${error.message}`);
  }
  if (!stats.isFile()) fail(`Staged content path is not a regular file: ${temporaryRelativePath}`);
  assertNoSymlinkPath(temporaryRelativePath);
  fs.rmSync(temporary);
  syncDirectory(path.dirname(temporary));
}

function atomicReplace(relativePath, content, expectedCurrent, temporaryRelativePath, retryStagedPath = false) {
  validateStagedSiblingPath(temporaryRelativePath, relativePath);
  let temporary;
  let temporaryCreated = false;
  try {
    assertCanonicalRoot();
    const target = expectedTargetState(relativePath, expectedCurrent);
    const mode = expectedCurrent === undefined ? 0o644 : fs.statSync(target).mode & 0o777;
    if (retryStagedPath) removeStagedTemporary(temporaryRelativePath, relativePath);
    temporary = assertNoSymlinkPath(temporaryRelativePath);
    const descriptor = fs.openSync(temporary, 'wx', mode);
    temporaryCreated = true;
    try {
      assertNoSymlinkPath(temporaryRelativePath);
      fs.writeFileSync(descriptor, content);
      if (process.platform !== 'win32') fs.fchmodSync(descriptor, mode);
      fs.fsyncSync(descriptor);
    } finally {
      fs.closeSync(descriptor);
    }
    assertCanonicalRoot();
    expectedTargetState(relativePath, expectedCurrent);
    temporary = assertNoSymlinkPath(temporaryRelativePath);
    fs.renameSync(temporary, assertNoSymlinkPath(relativePath));
    syncDirectory(path.dirname(resolveRepositoryPath(relativePath)));
  } catch (error) {
    if (temporary && temporaryCreated) {
      try {
        removeStagedTemporary(temporaryRelativePath, relativePath);
      } catch {
        // Preserve the original failure; unsafe cleanup is deliberately skipped.
      }
    }
    throw error;
  }
}

function syncCommittedOutputDirectories(journal) {
  const directories = new Set();
  for (const entry of journal.entries) {
    const target = assertNoSymlinkPath(entry.path);
    directories.add(path.dirname(target));
  }
  for (const directory of directories) syncDirectory(directory);
}

function readGenerationLock() {
  const lockPath = assertNoSymlinkPath(GENERATION_LOCK_PATH);
  let stats;
  try {
    stats = fs.lstatSync(lockPath);
  } catch (error) {
    if (error.code === 'ENOENT') return undefined;
    fail(`Cannot safely inspect content-generation lock: ${error.message}`);
  }
  if (!stats.isFile()) fail('Content-generation lock is not a regular file; refusing to proceed.');
  let lock;
  try {
    lock = JSON.parse(readRepositoryFile(GENERATION_LOCK_PATH).toString('utf8'));
  } catch (error) {
    fail(`Cannot safely read content-generation lock: ${error.message}`);
  }
  if (!Number.isSafeInteger(lock?.pid) || lock.pid < 1 ||
      typeof lock.token !== 'string' || !/^[0-9a-f-]{36}$/.test(lock.token)) {
    fail('Content-generation lock is invalid; refusing to proceed.');
  }
  return lock;
}

function acquireGenerationLock() {
  assertCanonicalRoot();
  const lockPath = assertNoSymlinkPath(GENERATION_LOCK_PATH);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const lock = { pid: process.pid, token: randomUUID() };
    let descriptor;
    try {
      descriptor = fs.openSync(lockPath, 'wx', 0o600);
      assertCanonicalRoot();
      fs.writeFileSync(descriptor, `${JSON.stringify(lock)}\n`, 'utf8');
      fs.fsyncSync(descriptor);
      fs.closeSync(descriptor);
      descriptor = undefined;
      syncDirectory(root);
      assertCanonicalRoot();
      return lock;
    } catch (error) {
      const cleanupErrors = [];
      if (descriptor !== undefined) {
        try {
          fs.closeSync(descriptor);
        } catch (closeError) {
          cleanupErrors.push(closeError);
        }
      }
      if (error.code !== 'EEXIST') {
        try {
          if (readGenerationLock()?.token === lock.token) {
            fs.unlinkSync(assertNoSymlinkPath(GENERATION_LOCK_PATH));
            syncDirectory(root);
          }
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
        if (cleanupErrors.length > 0) throw lockCleanupError(error, cleanupErrors);
        throw error;
      }
      if (cleanupErrors.length > 0) throw lockCleanupError(error, cleanupErrors);
      const currentLock = readGenerationLock();
      if (!currentLock) continue;
      fail(`Content generation is locked by PID ${currentLock.pid}. Confirm no content-generation process is active, manually remove the exact lock file ${GENERATION_LOCK_PATH}, then rerun.`);
    }
  }
  fail('Could not acquire the content-generation lock safely; refusing to proceed.');
}

function releaseGenerationLock(lock) {
  const currentLock = readGenerationLock();
  if (!currentLock || currentLock.token !== lock.token) return;
  assertCanonicalRoot();
  fs.unlinkSync(assertNoSymlinkPath(GENERATION_LOCK_PATH));
  syncDirectory(root);
}

function withGenerationLock(action) {
  const lock = acquireGenerationLock();
  let actionFailed = false;
  let actionError;
  try {
    return action();
  } catch (error) {
    actionFailed = true;
    actionError = error;
    throw error;
  } finally {
    try {
      releaseGenerationLock(lock);
    } catch (error) {
      const originalError = actionFailed
        ? actionError
        : new Error('Content generation completed, but releasing its lock failed.');
      throw lockCleanupError(originalError, [error]);
    }
  }
}

function persistJournal(journal) {
  assertSafeGenerationPaths();
  const temporary = resolveRepositoryPath(TRANSACTION_TEMP_PATH);
  const target = resolveRepositoryPath(TRANSACTION_PATH);
  assertCanonicalRoot();
  assertNoSymlinkPath(TRANSACTION_TEMP_PATH);
  assertNoSymlinkPath(TRANSACTION_PATH);
  const descriptor = fs.openSync(temporary, 'wx');
  try {
    assertNoSymlinkPath(TRANSACTION_TEMP_PATH);
    fs.writeFileSync(descriptor, `${JSON.stringify(journal)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  assertCanonicalRoot();
  assertNoSymlinkPath(TRANSACTION_TEMP_PATH);
  assertNoSymlinkPath(TRANSACTION_PATH);
  if (fs.existsSync(target)) fail(`Transaction journal appeared during generation: ${TRANSACTION_PATH}`);
  fs.renameSync(temporary, target);
  syncDirectory(root);
}

function markJournalCommitted(journal, onCommitted) {
  const temporary = assertNoSymlinkPath(TRANSACTION_TEMP_PATH);
  const target = assertNoSymlinkPath(TRANSACTION_PATH);
  const committedJournal = { ...journal, committed: true };
  const descriptor = fs.openSync(temporary, 'wx');
  try {
    assertNoSymlinkPath(TRANSACTION_TEMP_PATH);
    fs.writeFileSync(descriptor, `${JSON.stringify(committedJournal)}\n`, 'utf8');
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  assertCanonicalRoot();
  assertNoSymlinkPath(TRANSACTION_TEMP_PATH);
  assertNoSymlinkPath(TRANSACTION_PATH);
  fs.renameSync(temporary, target);
  Object.assign(journal, committedJournal);
  onCommitted();
  syncDirectory(root);
}

function transactionEntries(outputs, provenance) {
  assertSafeGenerationPaths();
  const contents = new Map(outputs);
  contents.set(PROVENANCE_PATH, `${JSON.stringify(provenance, null, 2)}\n`);
  return [...contents].map(([relativePath, content]) => {
    const target = assertNoSymlinkPath(relativePath);
    const exists = fs.existsSync(target);
    const previousContent = exists ? readRepositoryFile(relativePath) : undefined;
    const preserveCrLf = previousContent?.includes(Buffer.from('\r\n'));
    const nextContent = preserveCrLf ? content.replace(/\n/g, '\r\n') : content;
    return {
      path: relativePath,
      existed: exists,
      previousContent: previousContent?.toString('base64') ?? null,
      nextContent: Buffer.from(nextContent, 'utf8').toString('base64'),
      stagedPath: stagedSiblingPath(relativePath)
    };
  });
}

function loadJournal() {
  assertSafeGenerationPaths();
  const journalPath = assertNoSymlinkPath(TRANSACTION_PATH);
  if (!fs.existsSync(journalPath)) return undefined;
  let journal;
  try {
    journal = JSON.parse(readRepositoryFile(TRANSACTION_PATH).toString('utf8'));
  } catch (error) {
    fail(`Cannot read pending content-generation transaction journal: ${error.message}`);
  }
  const allowedPaths = new Set([...PAGE_ALLOWLIST, PROVENANCE_PATH]);
  if (journal?.version !== 2 ||
      (journal.committed !== undefined && typeof journal.committed !== 'boolean') ||
      !Array.isArray(journal.entries) ||
      journal.entries.length !== allowedPaths.size ||
      journal.entries.some(entry => !allowedPaths.has(entry.path) ||
        typeof entry.existed !== 'boolean' ||
        (entry.existed ? typeof entry.previousContent !== 'string' : entry.previousContent !== null) ||
        typeof entry.nextContent !== 'string' ||
        typeof entry.stagedPath !== 'string' ||
        (() => {
          try {
            validateStagedSiblingPath(entry.stagedPath, entry.path);
            return false;
          } catch {
            return true;
          }
        })() ||
        (entry.existed && Buffer.from(entry.previousContent, 'base64').toString('base64') !== entry.previousContent) ||
        Buffer.from(entry.nextContent, 'base64').toString('base64') !== entry.nextContent) ||
      new Set(journal.entries.map(entry => entry.path)).size !== allowedPaths.size ||
      new Set(journal.entries.map(entry => entry.stagedPath)).size !== allowedPaths.size) {
    fail('Pending content-generation transaction journal is invalid; refusing recovery.');
  }
  return journal;
}

function rollbackJournal(journal) {
  assertSafeGenerationPaths();
  for (const entry of journal.entries) {
    const target = assertNoSymlinkPath(entry.path);
    const exists = fs.existsSync(target);
    const previousContent = entry.existed ? Buffer.from(entry.previousContent, 'base64') : undefined;
    const nextContent = Buffer.from(entry.nextContent, 'base64');
    if (entry.existed && !exists) {
      fail(`Generated output disappeared during an interrupted transaction; refusing recovery: ${entry.path}`);
    }
    if (exists) {
      const currentContent = readRepositoryFile(entry.path);
      if ((!entry.existed || !currentContent.equals(previousContent)) && !currentContent.equals(nextContent)) {
        fail(`Generated output was manually changed during an interrupted transaction; refusing recovery: ${entry.path}`);
      }
    }
  }
  for (const entry of journal.entries) {
    assertSafeGenerationPaths();
    const target = assertNoSymlinkPath(entry.path);
    if (entry.existed) {
      const previousContent = Buffer.from(entry.previousContent, 'base64');
      const nextContent = Buffer.from(entry.nextContent, 'base64');
      if (!readRepositoryFile(entry.path).equals(previousContent)) {
        atomicReplace(entry.path, previousContent, nextContent, entry.stagedPath, true);
      }
    } else if (fs.existsSync(target)) {
      if (!readRepositoryFile(entry.path).equals(Buffer.from(entry.nextContent, 'base64'))) {
        fail(`Generated output was manually changed during an interrupted transaction; refusing recovery: ${entry.path}`);
      }
      assertCanonicalRoot();
      assertNoSymlinkPath(entry.path);
      fs.rmSync(target);
      syncDirectory(path.dirname(target));
    }
  }
  for (const entry of journal.entries) {
    removeStagedTemporary(entry.stagedPath, entry.path);
  }
  assertCanonicalRoot();
  syncDirectory(root);
  assertSafeGenerationPaths();
  fs.rmSync(assertNoSymlinkPath(TRANSACTION_PATH), { force: true });
  fs.rmSync(assertNoSymlinkPath(TRANSACTION_TEMP_PATH), { force: true });
  syncDirectory(root);
}

function cleanupCommittedJournal() {
  assertSafeGenerationPaths();
  for (const entry of loadJournal().entries) {
    removeStagedTemporary(entry.stagedPath, entry.path);
  }
  assertCanonicalRoot();
  fs.rmSync(assertNoSymlinkPath(TRANSACTION_PATH), { force: true });
  fs.rmSync(assertNoSymlinkPath(TRANSACTION_TEMP_PATH), { force: true });
  syncDirectory(root);
}

function recoverPendingTransaction() {
  assertSafeGenerationPaths();
  const journal = loadJournal();
  const temporary = assertNoSymlinkPath(TRANSACTION_TEMP_PATH);
  let temporaryStats;
  try {
    temporaryStats = fs.lstatSync(temporary);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      fail(`Cannot safely inspect transaction journal temporary path: ${error.message}`);
    }
  }
  if (temporaryStats) {
    assertCanonicalRoot();
    assertNoSymlinkPath(TRANSACTION_TEMP_PATH);
    if (!temporaryStats.isFile()) {
      fail(`Transaction journal temporary path is not a regular file: ${TRANSACTION_TEMP_PATH}`);
    }
    fs.rmSync(temporary);
    syncDirectory(root);
  }
  if (!journal) return;
  if (journal.committed) {
    try {
      cleanupCommittedJournal();
    } catch (error) {
      fail(`Generated outputs are committed, but transaction journal cleanup/durability is uncertain (${error.message}).`);
    }
    console.log('Recovered committed content-generation transaction journal.');
    return;
  }
  rollbackJournal(journal);
  console.log('Recovered and rolled back pending content-generation transaction.');
}

function writeOutputs(mapping, outputs, provenance, previous) {
  assertSafeGenerationPaths();
  if (previous) {
    verifyPreviousOutputs(previous);
    const previousPaths = new Set(previous.generatedPages);
    for (const relativePath of PAGE_ALLOWLIST) {
      if (!previousPaths.has(relativePath)) verifyBootstrapPage(mapping, relativePath);
    }
  } else verifyBootstrap(mapping, outputs);
  const journal = { version: 2, entries: transactionEntries(outputs, provenance) };
  persistJournal(journal);
  try {
    for (const entry of journal.entries) {
      assertInputsUnchanged(provenance);
      const previousContent = entry.existed ? Buffer.from(entry.previousContent, 'base64') : undefined;
      atomicReplace(entry.path, Buffer.from(entry.nextContent, 'base64'), previousContent, entry.stagedPath);
    }
    assertInputsUnchanged(provenance);
    syncCommittedOutputDirectories(journal);
    assertSafeGenerationPaths();
  } catch (error) {
    try {
      rollbackJournal(journal);
    } catch (rollbackError) {
      fail(`Content write failed (${error.message}) and rollback was incomplete (${rollbackError.message}); the transaction journal was retained for recovery.`);
    }
    throw error;
  }
  let committed = false;
  try {
    markJournalCommitted(journal, () => { committed = true; });
  } catch (error) {
    if (!committed) {
      try {
        rollbackJournal(journal);
      } catch (rollbackError) {
        fail(`Content commit marking failed (${error.message}) and rollback was incomplete (${rollbackError.message}); the transaction journal was retained for recovery.`);
      }
      throw error;
    }
    fail(`Generated outputs are committed, but transaction journal cleanup/durability is uncertain (${error.message}).`);
  }
  try {
    fs.rmSync(assertNoSymlinkPath(TRANSACTION_PATH));
    syncDirectory(root);
  } catch (error) {
    fail(`Generated outputs are committed, but transaction journal cleanup/durability is uncertain (${error.message}).`);
  }
  console.log(`Wrote ${outputs.size} generated page(s) and ${PROVENANCE_PATH}.`);
}

function assertInputsUnchanged(provenance) {
  for (const [relativePath, expectedHash] of [
    [SOURCE_PATH, provenance.sourceSha256],
    [SOURCE_MAP_PATH, provenance.sourceMapSha256],
    [CV_SECTIONS_PATH, provenance.cvSectionsSha256]
  ]) {
    const target = assertNoSymlinkPath(relativePath);
    if (sha256(normalizeText(readRepositoryFile(relativePath).toString('utf8'))) !== expectedHash) {
      fail(`Workspace input changed during generation; refusing to continue: ${relativePath}`);
    }
  }
  if (sha256(normalizeText(fs.readFileSync(generatorFilePath, 'utf8'))) !== provenance.generatorSha256) {
    fail('Workspace input changed during generation; refusing to continue: scripts/content/generate-content.mjs');
  }
  if (appCommitSha !== undefined && readAppCommitSha() !== appCommitSha) {
    fail('Checked-out app commit changed during generation; refusing to continue.');
  }
}

async function main() {
  const [mode, ...options] = process.argv.slice(2);
  const usage = 'Usage: node scripts/content/generate-content.mjs --validate-source|--check|--write [--root <dir>] [--app-version <vX.Y.Z>] [--app-commit-sha <40-hex>]';
  if (!['--validate-source', '--check', '--write'].includes(mode)) {
    fail(usage);
  }
  let rootPath = process.cwd();
  let requestedAppCommitSha;
  let requestedAppVersion;
  const seenOptions = new Set();
  for (let index = 0; index < options.length;) {
    const option = options[index];
    const value = options[index + 1];
    if (!value || value.startsWith('--') || seenOptions.has(option)) {
      fail(usage);
    }
    seenOptions.add(option);
    if (option === '--root') {
      rootPath = value;
    } else if (option === '--app-commit-sha') {
      requestedAppCommitSha = verifyAppCommitSha(value);
    } else if (option === '--app-version') {
      requestedAppVersion = verifyAppVersion(value);
    } else {
      fail(usage);
    }
    index += 2;
  }
  if (requestedAppVersion !== undefined) {
    if (requestedAppCommitSha !== undefined && requestedAppCommitSha !== requestedAppVersion.sha) {
      fail('--app-commit-sha and --app-version identify different commits.');
    }
    requestedAppCommitSha = requestedAppVersion.sha;
    appVersion = requestedAppVersion.version;
  }
  root = fs.realpathSync(path.resolve(rootPath));
  appCommitSha = requestedAppCommitSha;
  assertSafeGenerationPaths();
  if (mode === '--validate-source') {
    const { mapping, outputs } = load();
    console.log(`Validated canonical source ${mapping.source} and ${outputs.size} mapped pages.`);
    return;
  }
  return withGenerationLock(() => {
    assertSafeGenerationPaths();
    let loaded = load();
    if (mode === '--check' && fs.existsSync(assertNoSymlinkPath(TRANSACTION_PATH))) {
      fail(`Pending content-generation transaction journal found (${TRANSACTION_PATH}); run npm run content:generate to recover it before checking.`);
    }
    if (mode === '--write') {
      recoverPendingTransaction();
      loaded = load();
    }
    const { mapping, outputs, provenance } = loaded;
    const previous = readProvenance();
    if (mode === '--check') return checkOutputs(outputs, previous, provenance);
    if (previous?.appCommitSha !== undefined && appCommitSha === undefined) {
      fail('Existing generated provenance is pinned to an app commit SHA;       pass --app-version to preserve the pin.');
          }
          if (previous?.appVersion !== undefined && appVersion === undefined) {
            fail('Existing generated provenance records an app version; pass --app-version to preserve it.');
    }
    writeOutputs(mapping, outputs, provenance, previous);
  });
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
