import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import MarkdownIt from 'markdown-it';

function resolveRoot(args) {
  if (args.length === 0) return fs.realpathSync(process.cwd());
  if (args.length !== 2 || args[0] !== '--root' || !args[1]) {
    console.error('Usage: node scripts/content/validate-content.mjs [--root <dir>]');
    process.exit(1);
  }
  return fs.realpathSync(path.resolve(args[1]));
}

const root = resolveRoot(process.argv.slice(2));

function pathWithin(directory, candidate) {
  const relative = path.relative(directory, candidate);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

function assertContainedPath(directory, candidate, relativePath) {
  if (!pathWithin(directory, candidate)) {
    throw new Error(`Markdown path escapes its canonical root: ${relativePath}`);
  }
}

function isSymlinkOrReparsePoint(stats) {
  return stats.isSymbolicLink() ||
    (typeof stats.attributes === 'number' && (stats.attributes & 0x400) !== 0);
}

function assertSameFileIdentity(expected, actual, relativePath) {
  if (typeof expected.ino !== 'bigint' || expected.ino === 0n ||
      typeof actual.ino !== 'bigint' || actual.ino === 0n ||
      expected.dev !== actual.dev || expected.ino !== actual.ino) {
    throw new Error(`Markdown path changed during validation: ${relativePath}`);
  }
}

function canonicalCheckedPath(fullPath, stats, containmentRoot, relativePath) {
  let canonical;
  try {
    canonical = fs.realpathSync(fullPath);
  } catch (error) {
    throw new Error(`Cannot safely resolve Markdown path ${relativePath}: ${error.message}`);
  }
  assertContainedPath(containmentRoot, canonical, relativePath);
  let canonicalStats;
  try {
    canonicalStats = fs.statSync(canonical, { bigint: true });
  } catch (error) {
    throw new Error(`Cannot safely inspect canonical Markdown path ${relativePath}: ${error.message}`);
  }
  assertSameFileIdentity(stats, canonicalStats, relativePath);
  return canonical;
}

function inspectPath(fullPath, relativePath) {
  let stats;
  try {
    stats = fs.lstatSync(fullPath, { bigint: true });
  } catch (error) {
    throw new Error(`Cannot safely inspect Markdown path ${relativePath}: ${error.message}`);
  }
  if (isSymlinkOrReparsePoint(stats)) {
    throw new Error(`Symlink or reparse point is not allowed in the selected root: ${relativePath}`);
  }
  return stats;
}

const rootIdentity = inspectPath(root, 'data root');
if (!rootIdentity.isDirectory()) throw new Error('Selected data root is not a directory.');
canonicalCheckedPath(root, rootIdentity, root, 'data root');

function resolveCanonicalPagesRoot() {
  let current = root;
  let pagesRootIdentity;
  for (const component of ['content', 'pages']) {
    current = path.join(current, component);
    const relativePath = path.relative(root, current).split(path.sep).join('/');
    const stats = inspectPath(current, relativePath);
    if (!stats.isDirectory()) throw new Error(`Content pages path is not a directory: ${relativePath}`);
    current = canonicalCheckedPath(current, stats, root, relativePath);
    if (component === 'pages') pagesRootIdentity = stats;
  }
  return { path: current, identity: pagesRootIdentity };
}

const pagesRootInfo = resolveCanonicalPagesRoot();
const pagesRoot = pagesRootInfo.path;
const pagesRootIdentity = pagesRootInfo.identity;

function enumerateMarkdownFiles(directory = pagesRoot, relativeDirectory = '', expectedDirectoryStats = pagesRootIdentity) {
  const relativePath = relativeDirectory ? `content/pages/${relativeDirectory}` : 'content/pages';
  const directoryStats = inspectPath(directory, relativePath);
  if (!directoryStats.isDirectory()) throw new Error(`Markdown parent is not a directory: ${relativePath}`);
  assertSameFileIdentity(expectedDirectoryStats, directoryStats, relativePath);
  const canonicalDirectory = canonicalCheckedPath(directory, directoryStats, pagesRoot, relativePath);

  let entries;
  try {
    entries = fs.readdirSync(canonicalDirectory, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Cannot safely enumerate ${relativePath}: ${error.message}`);
  }
  const afterStats = inspectPath(canonicalDirectory, relativePath);
  if (!afterStats.isDirectory()) throw new Error(`Markdown parent changed during validation: ${relativePath}`);
  const afterCanonical = canonicalCheckedPath(canonicalDirectory, afterStats, pagesRoot, relativePath);
  assertSameFileIdentity(directoryStats, afterStats, relativePath);
  let afterEntries;
  try {
    afterEntries = fs.readdirSync(afterCanonical, { withFileTypes: true });
  } catch (error) {
    throw new Error(`Cannot revalidate ${relativePath}: ${error.message}`);
  }
  const entryNames = entries.map(entry => entry.name).sort();
  const afterEntryNames = afterEntries.map(entry => entry.name).sort();
  if (JSON.stringify(entryNames) !== JSON.stringify(afterEntryNames)) {
    throw new Error(`Content pages directory changed during validation: ${relativePath}`);
  }

  const files = [];
  for (const entry of entries) {
    const childRelativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
    const fullPath = path.join(canonicalDirectory, entry.name);
    const stats = inspectPath(fullPath, `content/pages/${childRelativePath}`);
    if (entry.name.endsWith('.md') && !stats.isFile()) {
      throw new Error(`Markdown path is not a regular file: content/pages/${childRelativePath}`);
    }
    const canonical = canonicalCheckedPath(
      fullPath, stats, pagesRoot, `content/pages/${childRelativePath}`
    );
    if (stats.isDirectory()) {
      files.push(...enumerateMarkdownFiles(canonical, childRelativePath, stats));
    } else if (entry.name.endsWith('.md')) {
      files.push(childRelativePath);
    }
  }
  return files;
}


function readRegularFileWithinRoot(relativePath, baseDirectory, canonicalRoot, baseIdentity, baseLabel) {
  if (typeof relativePath !== 'string' || relativePath.includes('\\') ||
      path.posix.isAbsolute(relativePath) ||
      relativePath.split('/').some(part => part === '' || part === '.' || part === '..')) {
    throw new Error(`Unsafe data path: ${relativePath}`);
  }
  const baseStats = inspectPath(baseDirectory, baseLabel);
  if (!baseStats.isDirectory()) throw new Error(`Data path parent is not a directory: ${baseLabel}`);
  assertSameFileIdentity(baseIdentity, baseStats, baseLabel);
  let current = canonicalCheckedPath(baseDirectory, baseStats, canonicalRoot, baseLabel);
  let finalStats;
  const parts = relativePath.split('/');
  const displayPath = baseLabel === 'content/pages'
    ? `content/pages/${relativePath}`
    : relativePath;
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const relative = baseLabel === 'content/pages'
      ? `content/pages/${parts.slice(0, index + 1).join('/')}`
      : parts.slice(0, index + 1).join('/');
    const stats = inspectPath(current, relative);
    if (index < parts.length - 1 && !stats.isDirectory()) {
      throw new Error(`Data path parent is not a directory: ${relative}`);
    }
    if (index === parts.length - 1 && !stats.isFile()) {
      throw new Error(`Data path is not a regular file: ${relative}`);
    }
    current = canonicalCheckedPath(current, stats, canonicalRoot, relative);
    if (index === parts.length - 1) finalStats = stats;
  }
  let descriptor;
  try {
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    const nonBlocking = fs.constants.O_NONBLOCK ?? 0;
    descriptor = fs.openSync(current, fs.constants.O_RDONLY | noFollow | nonBlocking);
    const openedStats = fs.fstatSync(descriptor, { bigint: true });
    if (!openedStats.isFile()) throw new Error(`Data path is not a regular file: ${displayPath}`);
    assertSameFileIdentity(finalStats, openedStats, displayPath);
    const canonical = fs.realpathSync(current);
    assertContainedPath(canonicalRoot, canonical, displayPath);
    assertSameFileIdentity(openedStats, fs.statSync(canonical, { bigint: true }), displayPath);
    return fs.readFileSync(descriptor, 'utf8');
  } catch (error) {
    if (error.message.startsWith('Data path is not a regular file:') ||
        error.message.startsWith('Data path escapes its canonical root:') ||
        error.message.startsWith('Markdown path changed during validation:')) throw error;
    throw new Error(`Cannot safely read data path ${displayPath}: ${error.message}`);
  } finally {
    if (descriptor !== undefined) fs.closeSync(descriptor);
  }
}

function readMarkdownFile(relativePath) {
  return readRegularFileWithinRoot(relativePath, pagesRoot, pagesRoot, pagesRootIdentity, 'content/pages');
}
const settings = JSON.parse(readRegularFileWithinRoot('content/site.json', root, root, rootIdentity, 'data root'));
const locales = new Set(settings.supportedLocales ?? []);
const siteUrl = new URL(settings.siteUrl);
const files = enumerateMarkdownFiles();
const documents = [];
const failures = [];
const seenTechItems = new Set();
for (const group of settings.techGroups ?? []) {
  const items = Array.isArray(group?.items) ? group.items.map(item => (typeof item === 'string' ? item.trim() : '')) : [];
  if (typeof group?.name !== 'string' || !group.name.trim() || items.length === 0 || items.includes('')) {
    failures.push('content/site.json: every techGroups entry needs a name and non-empty items');
    continue;
  }
  for (const item of items) {
    if (seenTechItems.has(item.toLowerCase())) failures.push(`content/site.json: techGroups lists '${item}' more than once`);
    seenTechItems.add(item.toLowerCase());
  }
}
const techReviewIgnored = settings.techReview?.ignored;
if (settings.techReview !== undefined &&
    (!Array.isArray(techReviewIgnored) || techReviewIgnored.some(item => typeof item !== 'string' || !item.trim()))) {
  failures.push('content/site.json: techReview.ignored must be an array of non-empty strings');
} else {
  const seenIgnored = new Set();
  for (const item of techReviewIgnored ?? []) {
    if (seenIgnored.has(item.trim().toLowerCase())) failures.push(`content/site.json: techReview.ignored lists '${item}' more than once`);
    seenIgnored.add(item.trim().toLowerCase());
  }
}
const markdownParser = new MarkdownIt('commonmark', { html: true });
markdownParser.validateLink = () => true;
markdownParser.normalizeLink = destination => destination;
const fieldsByType = new Map(Object.entries({
  page: { title: 'string', description: 'string' },
  profile: { displayName: 'string', headline: 'string', summary: 'string' },
  experience: { role: 'string', organization: 'string', dates: 'string', highlights: 'string[]' },
  project: { title: 'string', summary: 'string', technologies: 'string[]' },
  service: { label: 'string', description: 'string' },
  skill: { label: 'string', description: 'string' }
}));


function markdownDestinations(body) {
  const destinations = [];
  const visit = tokens => {
    for (const token of tokens) {
      if (token.type === 'link_open') {
        destinations.push({ type: 'link', destination: token.attrGet('href') ?? '' });
      } else if (token.type === 'image') {
        destinations.push({ type: 'image', destination: token.attrGet('src') ?? '' });
      }
      if (token.children) visit(token.children);
    }
  };
  visit(markdownParser.parse(body, {}));
  return destinations;
}

function validateRawHtml(body, fail) {
  const visit = tokens => {
    for (const token of tokens) {
      if (['html_inline', 'html_block'].includes(token.type)) {
        fail('raw HTML is not allowed in Markdown content');
      }
      if (token.children) visit(token.children);
    }
  };
  visit(markdownParser.parse(body, {}));
}

function inspectDestinationEncoding(destination) {
  let value = destination;
  let hasControlCharacter = /[\u0000-\u001f\u007f-\u009f]/u.test(value);
  let isProtocolRelative = value.startsWith('//');
  for (let pass = 0; pass < 8; pass += 1) {
    let decoded;
    try { decoded = decodeURIComponent(value); }
    catch { throw new Error('invalid percent encoding'); }
    hasControlCharacter ||= /[\u0000-\u001f\u007f-\u009f]/u.test(decoded);
    isProtocolRelative ||= decoded.startsWith('//');
    if (decoded === value) return { hasControlCharacter, isProtocolRelative };
    value = decoded;
  }
  try {
    const decoded = decodeURIComponent(value);
    hasControlCharacter ||= /[\u0000-\u001f\u007f-\u009f]/u.test(decoded);
    isProtocolRelative ||= decoded.startsWith('//');
    if (decoded === value) return { hasControlCharacter, isProtocolRelative };
  } catch { /* fail closed below */ }
  throw new Error('excessive nested percent encoding');
}

function inspectRawDestination(destination, scheme) {
  if (scheme !== 'http' && scheme !== 'https') {
    return { authority: null, path: scheme ? '' : destination.split(/[?#]/u, 1)[0] };
  }
  const prefix = destination.match(/^https?:\/\//iu);
  if (!prefix) throw new Error('web destination must use explicit http:// or https:// spelling');
  const remainder = destination.slice(prefix[0].length);
  const authorityEnd = remainder.search(/[/?#]/u);
  const authority = authorityEnd < 0 ? remainder : remainder.slice(0, authorityEnd);
  if (!authority) throw new Error('web destination must include a non-empty authority');
  if (authority.includes('@')) throw new Error('web destination must not contain URL userinfo');
  if (authority.includes('%')) throw new Error('web destination authority must not contain percent escapes');
  const path = authorityEnd >= 0 && remainder[authorityEnd] === '/'
    ? remainder.slice(authorityEnd).split(/[?#]/u, 1)[0]
    : '';
  return { authority, path };
}

function hasDotPathSegment(pathname) {
  for (const segment of pathname.split('/')) {
    let value = segment;
    for (let pass = 0; pass <= 8; pass += 1) {
      const decoded = decodeURIComponent(value);
      if (decoded === value) break;
      value = decoded;
    }
    if (value === '.' || value === '..') return true;
  }
  return false;
}

function isCanonicalAuthority(authority, scheme, url) {
  const hostname = url.hostname;
  if (hostname.endsWith('.')) return false;
  if (!hostname.startsWith('[') && hostname.split('.').some(label =>
    label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label))) return false;

  const defaultPort = scheme === 'https' ? '443' : '80';
  return authority === url.host || authority === `${hostname}:${defaultPort}`;
}

function inspectRawAuthority(destination, scheme) {
  if (scheme !== 'http' && scheme !== 'https') return null;
  const prefix = destination.match(/^https?:\/\//iu);
  if (!prefix) throw new Error('web destination must use explicit http:// or https:// spelling');
  const remainder = destination.slice(prefix[0].length);
  const authorityEnd = remainder.search(/[/?#]/u);
  const authority = authorityEnd < 0 ? remainder : remainder.slice(0, authorityEnd);
  if (!authority) throw new Error('web destination must include a non-empty authority');
  if (authority.includes('@')) throw new Error('web destination must not contain URL userinfo');
  return authority;
}

function inspectEncodedPath(pathname) {
  let value = pathname;
  for (let pass = 0; pass < 8; pass += 1) {
    if (/%(?:2f|5c)/iu.test(value)) return 'separator';
    if (/%(?:3a|3f|23)/iu.test(value)) return 'reserved delimiter';
    const decoded = decodeURIComponent(value);
    if (decoded === value) return null;
    value = decoded;
  }
  if (/%(?:2f|5c)/iu.test(value)) return 'separator';
  if (/%(?:3a|3f|23)/iu.test(value)) return 'reserved delimiter';
  if (decodeURIComponent(value) !== value) throw new Error('excessive nested percent encoding');
  return null;
}

function destinationBoundaryError(destination) {
  if (/[\u0000-\u001f\u007f-\u009f]/u.test(destination)) {
    return 'control character is not allowed in a Markdown destination';
  }
  if (/^\s|\s$/u.test(destination)) {
    return 'leading or trailing whitespace is not allowed in a Markdown destination';
  }
  return null;
}

function validateMarkdownDestinations(body, fail, currentPageBase) {
  const destinations = markdownDestinations(body);
  for (const { type, destination } of destinations) {
    const boundaryError = destinationBoundaryError(destination);
    if (boundaryError) {
      fail(boundaryError);
      continue;
    }

    let encoding;
    try { encoding = inspectDestinationEncoding(destination); }
    catch {
      fail(`destination '${destination}' has invalid percent encoding`);
      continue;
    }
    if (encoding.hasControlCharacter) {
      fail('control character is not allowed in a Markdown destination');
      continue;
    }
    const scheme = destination.match(/^([a-z][a-z\d+.-]*):/iu)?.[1]?.toLowerCase();
    let rawDestination;
    let rawPath;
    try {
      rawDestination = inspectRawDestination(destination, scheme);
      rawPath = rawDestination.path;
    } catch (error) {
      fail(`destination '${destination}' ${error.message}`);
      continue;
    }
    if (destination.includes('\\')) {
      fail('backslash is not allowed in a Markdown destination');
      continue;
    }
    if (encoding.isProtocolRelative) {
      fail('protocol-relative destination is not allowed');
      continue;
    }
    if (destination.startsWith('#') &&
        !/^#(?:[\p{L}\p{N}._~!$&'()*+,;=:@/?-]|%[0-9a-f]{2})*$/iu.test(destination)) {
      fail(`invalid fragment-only destination '${destination}'`);
      continue;
    }
    let rawPathIssue;
    try { rawPathIssue = inspectEncodedPath(rawPath); }
    catch {
      fail(`destination '${destination}' has invalid percent encoding in its URL path`);
      continue;
    }
    if (rawPathIssue === 'separator') {
      fail(`destination '${destination}' has an encoded separator in its URL path`);
      continue;
    }
    if (rawPathIssue === 'reserved delimiter') {
      fail(`destination '${destination}' has an encoded reserved delimiter in its URL path`);
      continue;
    }
    if (hasDotPathSegment(rawPath)) {
      fail(`destination '${destination}' has a dot path segment`);
      continue;
    }

    if (scheme && !['http', 'https', 'mailto', 'tel'].includes(scheme)) {
      fail(`URL scheme '${scheme}' is not allowed`);
    }
    if (type === 'image' && ['http', 'https'].includes(scheme)) {
      fail('external image destination is not allowed');
    }

    let parsed;
    try { parsed = new URL(destination, currentPageBase); }
    catch {
      fail(`destination '${destination}' is not a valid URL`);
      continue;
    }
    if (rawDestination.authority !== null && !isCanonicalAuthority(rawDestination.authority, scheme, parsed)) {
      fail(`destination '${destination}' authority is not in canonical form`);
    }
  }
  return destinations;
}

for (const file of files) {
  const parsed = matter(readMarkdownFile(file));
  const slug = file.replace(/\.md$/, '');
  const data = parsed.data;
  const fail = message => failures.push(`${file}: ${message}`);
  documents.push({ file, slug, data, body: parsed.content });
  for (const field of ['title', 'description', 'locale', 'status', 'type']) {
    if (typeof data[field] !== 'string' || data[field].trim() === '') fail(`required field '${field}' is missing`);
  }
  if (!['draft', 'published'].includes(data.status)) fail("status must be 'draft' or 'published'");
  if (!locales.has(data.locale)) fail(`unsupported locale '${data.locale}'`);
  if (!fieldsByType.has(data.type)) fail(`unknown content type '${data.type}'`);
  else for (const [field, expectedType] of Object.entries(fieldsByType.get(data.type))) {
    const value = data[field];
    if (expectedType === 'string') {
      if (typeof value !== 'string' || value.trim() === '') {
        fail(`content type '${data.type}' requires '${field}' as a non-empty string`);
      }
    } else if (!Array.isArray(value) || value.length === 0 ||
        value.some(item => typeof item !== 'string' || item.trim() === '')) {
      fail(`content type '${data.type}' requires '${field}' as a non-empty array of non-empty strings`);
    }
  }
  if (data.type === 'project' && data.links !== undefined &&
      (typeof data.links !== 'string' || data.links.trim() === '')) {
    fail("content type 'project' requires 'links' as a non-empty string when present");
  }
  if (data.status === 'published' && parsed.content.trim() === '') fail('published content body is empty');
  validateRawHtml(parsed.content, fail);
  const currentRoute = slug === 'home' ? '/' : `/${slug}`;
  validateMarkdownDestinations(parsed.content, fail, `https://app.invalid${currentRoute}`);
}

const published = documents.filter(document => document.data.status === 'published');
for (const field of ['slug', 'title', 'description']) {
  const values = new Map();
  for (const document of published) {
    const value = field === 'slug' ? document.slug : document.data[field];
    if (typeof value !== 'string') continue;
    const key = `${document.data.locale}:${value.toLowerCase()}`;
    if (values.has(key)) failures.push(`${document.file}: ${field} '${value}' is not unique in locale '${document.data.locale}'`);
    values.set(key, document.file);
  }
}
const approvedRoutes = new Set(['/', '/cv', '/projects', '/services', '/contact']);
for (const document of published) {
  const projectSlug = document.slug.match(/^projects\/([^/]+)$/u)?.[1];
  if (document.data.type === 'project' && projectSlug) {
    approvedRoutes.add(`/projects/${projectSlug}`.toLowerCase());
  }
}
function canonicalHostname(hostname) {
  return hostname.toLowerCase().replace(/^www\./u, '');
}

function isSameSiteHttps(url) {
  return url.protocol === 'https:' && siteUrl.protocol === 'https:' &&
    url.port === siteUrl.port && canonicalHostname(url.hostname) === canonicalHostname(siteUrl.hostname);
}

for (const document of published) {
  for (const { type, destination } of markdownDestinations(document.body)) {
    if (type !== 'link') continue;
    if (destinationBoundaryError(destination)) continue;
    const scheme = destination.match(/^([a-z][a-z\d+.-]*):/iu)?.[1]?.toLowerCase();
    if (destination.startsWith('#')) continue;
    if (scheme && !['http', 'https'].includes(scheme)) continue;

    const currentRoute = document.slug === 'home' ? '/' : `/${document.slug}`;
    let rawDestination;
    try {
      rawDestination = inspectRawDestination(destination, scheme);
    } catch (error) {
      failures.push(`${document.file}: internal link '${destination}' ${error.message}`);
      continue;
    }
    let resolved;
    try {
      resolved = scheme
        ? new URL(destination)
        : new URL(destination, `${siteUrl.origin}${currentRoute}`);
    } catch {
      failures.push(`${document.file}: internal link '${destination}' has an invalid route`);
      continue;
    }
    if (rawDestination.authority !== null && !isCanonicalAuthority(rawDestination.authority, scheme, resolved)) {
      failures.push(`${document.file}: internal link '${destination}' authority is not in canonical form`);
      continue;
    }
    if (scheme && (scheme !== 'https' || !isSameSiteHttps(resolved))) continue;

    const route = resolved.pathname.replace(/\/+$/u, '').toLowerCase() || '/';
    if (!approvedRoutes.has(route)) {
      failures.push(`${document.file}: internal link '${destination}' is not an approved application route`);
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Validated ${documents.length} Markdown document(s); ${published.length} published.`);
