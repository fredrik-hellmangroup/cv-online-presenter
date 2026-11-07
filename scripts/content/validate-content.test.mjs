import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const validatorPath = path.join(repositoryRoot, 'scripts', 'content', 'validate-content.mjs');
const syntheticFixturePath = path.join(repositoryRoot, 'scripts', 'content', 'fixtures', 'synthetic');
const target = (root, relative) => path.join(root, ...relative.split('/'));
function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-content-validator-'));
  try {
    fs.cpSync(path.join(syntheticFixturePath, 'content'), target(root, 'content'), { recursive: true });
    return root;
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

function withFixture(callback) {
  const root = createFixture();
  try { return callback(root); }
  finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function run(root) {
  return spawnSync(process.execPath, [validatorPath], { cwd: root, encoding: 'utf8' });
}
function createSymlinkOrSkip(t, targetPath, linkPath, type) {
  try {
    fs.symlinkSync(targetPath, linkPath, type);
    return true;
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'UNKNOWN'].includes(error.code)) {
      t.skip('Platform denied symlink creation (' + error.code + ').');
      return false;
    }
    throw error;
  }
}
function addDocument(root, type, fields) {
  const fieldLines = Object.entries(fields).map(([field, value]) => `${field}: ${value}`).join('\n');
  const content = `---\ntitle: Valid title\ndescription: Valid description\nlocale: sv-SE\nstatus: draft\ntype: ${type}\n${fieldLines}\n---\nContent.\n`;
  const file = target(root, `content/pages/schema-${type}.md`);
  fs.writeFileSync(file, content);
  return file;
}
test('rejects empty, unnamed and duplicated techGroups in site.json', () => withFixture(root => {
  const siteFile = target(root, 'content/site.json');
  const site = JSON.parse(fs.readFileSync(siteFile, 'utf8'));
  const cases = [
    [[{ name: '', items: ['A'] }], /needs a name and non-empty items/],
    [[{ name: 'Core', items: [] }], /needs a name and non-empty items/],
    [[{ name: 'Core', items: ['A'] }, { name: 'Data', items: ['a'] }], /lists 'a' more than once/]
  ];
  for (const [techGroups, message] of cases) {
    fs.writeFileSync(siteFile, JSON.stringify({ ...site, techGroups }));
    const result = run(root);
    assert.notEqual(result.status, 0, JSON.stringify(techGroups));
    assert.match(result.stderr, message);
  }
  fs.writeFileSync(siteFile, JSON.stringify({ ...site, techGroups: [{ name: 'Core', items: ['A', 'B'] }] }));
  assert.equal(run(root).status, 0);
}));
test('rejects malformed or duplicated techReview.ignored in site.json', () => withFixture(root => {
  const siteFile = target(root, 'content/site.json');
  const site = JSON.parse(fs.readFileSync(siteFile, 'utf8'));
  const cases = [
    [{ ignored: 'SOLID' }, /must be an array of non-empty strings/],
    [{ ignored: ['SOLID', ''] }, /must be an array of non-empty strings/],
    [{ ignored: ['SOLID', 'solid'] }, /lists 'solid' more than once/]
  ];
  for (const [techReview, message] of cases) {
    fs.writeFileSync(siteFile, JSON.stringify({ ...site, techReview }));
    const result = run(root);
    assert.notEqual(result.status, 0, JSON.stringify(techReview));
    assert.match(result.stderr, message);
  }
  fs.writeFileSync(siteFile, JSON.stringify({ ...site, techReview: { ignored: ['SOLID'] } }));
  assert.equal(run(root).status, 0);
}));
test('rejects array and object values for required title and description strings', () => withFixture(root => {
  const cases = [
    ['title', 'title: [Invalid]'],
    ['title', 'title: { value: Invalid }'],
    ['description', 'description: [Invalid]'],
    ['description', 'description: { value: Invalid }']
  ];
  for (const [field, replacement] of cases) {
    const home = target(root, 'content/pages/home.md');
    const original = fs.readFileSync(home, 'utf8');
    const updated = original.replace(new RegExp(`^${field}:.*$`, 'm'), replacement);
    fs.writeFileSync(home, updated);
    const result = run(root);
    assert.notEqual(result.status, 0, `accepted ${replacement}`);
    assert.match(result.stderr, new RegExp(`required field '${field}'`));
    fs.writeFileSync(home, original);
  }
}));
test('validates required fields and array item types for every content type', () => withFixture(root => {
  const cases = [
    ['page', { title: '[Invalid]' }],
    ['profile', { displayName: '[Invalid]', headline: 'Headline', summary: 'Summary' }],
    ['experience', { role: 'Role', organization: 'Org', dates: '2024', highlights: 'not-an-array' }],
    ['project', { summary: 'Summary', technologies: '[Valid, 42]', links: 'Links' }],
    ['service', { label: '{ value: Invalid }', description: 'Description' }],
    ['skill', { label: 'Label', description: '[Invalid]' }]
  ];
  for (const [type, fields] of cases) {
    const file = addDocument(root, type, fields);
    const result = run(root);
    assert.notEqual(result.status, 0, `accepted invalid ${type} fields`);
    fs.unlinkSync(file);
  }
}));

test('rejects inherited property names as content types', () => withFixture(root => {
  for (const type of ['constructor', '__proto__']) {
    const file = addDocument(root, type, {});
    const result = run(root);
    assert.notEqual(result.status, 0, `accepted inherited content type ${type}`);
    assert.match(result.stderr, new RegExp(`unknown content type '${type.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}'`));
    fs.unlinkSync(file);
  }
}));
test('checks CommonMark reference links and images after character-reference decoding', () => withFixture(root => {
  const page = target(root, 'content/pages/unsafe-destinations.md');
  fs.writeFileSync(page, [
    '---', 'title: Unsafe destinations', 'description: URL parser test', 'locale: sv-SE',
    'status: draft', 'type: page', '---',
    '[unsafe reference][bad-link]', '',
    '[bad-link]: javascript&#58;alert%281%29',
    '', '![unsafe image](javascript&#58;alert%281%29)', ''
  ].join('\n'));
  const result = run(root);
  assert.notEqual(result.status, 0, 'unsafe reference-link and image destinations must be rejected');
  assert.match(result.stderr, /URL scheme 'javascript' is not allowed/);
}));
test('rejects boundary whitespace and controls before URL normalization', () => withFixture(root => {
  const page = target(root, 'content/pages/boundary-destinations.md');
  const cases = [
    '[userinfo link](< https://user@evil.example/path>)',
    '![userinfo image](< https://user@evil.example/path>)',
    '[control link](<\thttps://user@evil.example/path>)',
    '![control image](<\thttps://user@evil.example/path>)',
    '[trailing whitespace](<https://user@evil.example/path >)'
  ];
  for (const [index, markdown] of cases.entries()) {
    fs.writeFileSync(page, [
      '---', `title: Boundary destination ${index}`, 'description: URL parser test', 'locale: sv-SE',
      'status: draft', 'type: page', '---', markdown, ''
    ].join('\n'));
    const result = run(root);
    assert.notEqual(result.status, 0, `accepted boundary whitespace/control in ${markdown}`);
    assert.match(result.stderr, /(?:leading|trailing) whitespace|control character.*destination/i);
    assert.doesNotMatch(result.stderr, /must not contain URL userinfo|URL scheme/i);
  }
}));

test('preserves valid normalized Markdown destinations', () => withFixture(root => {
  const page = target(root, 'content/pages/valid-destinations.md');
  fs.writeFileSync(page, [
    '---', 'title: Valid destinations', 'description: URL parser test', 'locale: sv-SE',
    'status: draft', 'type: page', '---',
    '[external link](https://example.com/path)',
    '![relative image](/images/example.png)',
    '[fragment](#section)', ''
  ].join('\n'));
  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));

test('ignores Markdown links and images inside fenced and inline code', () => withFixture(root => {
  const page = target(root, 'content/pages/code-links.md');
  fs.writeFileSync(page, [
    '---', 'title: Code links', 'description: URL parser test', 'locale: sv-SE',
    'status: published', 'type: page', '---',
    'Inline code: `[missing](/missing-target)` and `![missing](/missing-image)`.',
    '', '```markdown', '[missing](/missing-fenced-target)', '![missing](/missing-fenced-image)', '```', ''
  ].join('\n'));
  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));

test('rejects raw HTML instead of passing unvalidated markup through', () => withFixture(root => {
  const cases = [
    '<script>alert(1)</script>',
    '<a href="javascript&#58;alert(1)">unsafe</a>',
    '<h1>Raw heading</h1>',
    '<em>Even harmless-looking HTML is not allowed</em>'
  ];
  for (const [index, rawHtml] of cases.entries()) {
    const page = target(root, `content/pages/raw-html-${index}.md`);
    fs.writeFileSync(page, [
      '---', `title: Raw HTML ${index}`, 'description: Raw HTML test', 'locale: sv-SE',
      'status: draft', 'type: page', '---', rawHtml, ''
    ].join('\n'));
    const result = run(root);
    assert.notEqual(result.status, 0, `accepted raw HTML: ${rawHtml}`);
    assert.match(result.stderr, /raw HTML is not allowed/i);
    fs.unlinkSync(page);
  }
}));
test('rejects control characters in parsed link, image, and reference destinations', () => withFixture(root => {
  const page = target(root, 'content/pages/control-destinations.md');
  const destinations = [
    '[tab](java&#x09;script:alert(1))',
    '![newline](java&#x0A;script:alert(1))',
    '[reference][bad]\n\n[bad]: java&#x0A;script:alert(1)'
  ];
  for (const [index, markdown] of destinations.entries()) {
    fs.writeFileSync(page, [
      '---', `title: Control destination ${index}`, 'description: URL parser test', 'locale: sv-SE',
      'status: draft', 'type: page', '---', markdown, ''
    ].join('\n'));
    const result = run(root);
    assert.notEqual(result.status, 0, `accepted control character in ${markdown}`);
    assert.match(result.stderr, /control character.*destination/i);
  }
}));

test('rejects protocol-relative link and image destinations', () => withFixture(root => {
  const page = target(root, 'content/pages/protocol-relative.md');
  const cases = [
    '[external link](//attacker.example/path)',
    '[entity link](&#x2f;&#x2f;attacker.example/path)',
    '[encoded link](%2F%2Fattacker.example/path)',
    '![external image](//attacker.example/image.svg)',
    '![entity image](&#x2f;&#x2f;attacker.example/image.svg)',
    '[reference][external]\n\n[external]: //attacker.example/path'
  ];
  for (const [index, markdown] of cases.entries()) {
    fs.writeFileSync(page, [
      '---', `title: Protocol relative ${index}`, 'description: URL parser test', 'locale: sv-SE',
      'status: draft', 'type: page', '---', markdown, ''
    ].join('\n'));
    const result = run(root);
    assert.notEqual(result.status, 0, `accepted protocol-relative destination: ${markdown}`);
    assert.match(result.stderr, /protocol-relative destination is not allowed/i);
  }
}));
test('rejects unapproved external image destinations while allowing local images', () => withFixture(root => {
  const page = target(root, 'content/pages/external-image.md');
  fs.writeFileSync(page, [
    '---', 'title: External image', 'description: URL parser test', 'locale: sv-SE',
    'status: draft', 'type: page', '---',
    '![external](https://images.example.test/photo.png)',
    '![scheme-relative](https:images.example.test/photo.png)', ''
  ].join('\n'));
  const result = run(root);
  assert.notEqual(result.status, 0, 'unapproved external image must be rejected');
  assert.match(result.stderr, /external image destination is not allowed/i);
  fs.writeFileSync(page, [
    '---', 'title: Local image', 'description: URL parser test', 'locale: sv-SE',
    'status: draft', 'type: page', '---',
    '![local](/images/photo.png)', ''
  ].join('\n'));
  const localResult = run(root);
  assert.equal(localResult.status, 0, localResult.stderr || localResult.stdout);
}));
test('approves only core routes and one-level published project routes', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  const originalHome = fs.readFileSync(home, 'utf8');
  fs.appendFileSync(home, '\n\n[Unrelated page](/unrelated)\n');
  const unrelated = target(root, 'content/pages/unrelated.md');
  fs.writeFileSync(unrelated, [
    '---', 'title: Unrelated', 'description: An unrelated published page', 'locale: sv-SE',
    'status: published', 'type: page', '---', 'Published but not an application route.', ''
  ].join('\n'));
  const unrelatedResult = run(root);
  assert.notEqual(unrelatedResult.status, 0);
  assert.match(unrelatedResult.stderr, /internal link '\/unrelated' is not an approved application route/i);
  fs.unlinkSync(unrelated);

  fs.writeFileSync(home, originalHome + '\n\n[Available project](/projects/available)\n');
  const project = target(root, 'content/pages/projects/available.md');
  fs.writeFileSync(project, [
    '---', 'title: Available project', 'description: A published test project', 'locale: sv-SE',
    'status: published', 'type: project', 'summary: A published test project',
    'technologies: [Node.js]', '---', 'Project details.', ''
  ].join('\n'));
  const projectResult = run(root);
  assert.equal(projectResult.status, 0, projectResult.stderr || projectResult.stdout);

  fs.writeFileSync(project, fs.readFileSync(project, 'utf8').replace('status: published', 'status: draft'));
  const draftResult = run(root);
  assert.notEqual(draftResult.status, 0);
  assert.match(draftResult.stderr, /internal link '\/projects\/available' is not an approved application route/i);
}));
test('preserves known contact, CV, projects, services, and generated project routes', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[Contact](/contact) [CV](/cv) [Projects](/projects) [Services](/services) ' +
    '[Projekt Lanternan](/projects/lanternan) [Projekt Kompass](/projects/kompass) [Projekt Grön Stig](/projects/gron-stig)\n');
  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));

test('does not trust arbitrary project routes added to source-map regex entries', () => withFixture(root => {
  const mapPath = target(root, 'content/source-map.json');
  const sourceMap = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  sourceMap.generatedPages.push({ type: 'project', path: 'content/pages/projects/injected-route.md' });
  fs.writeFileSync(mapPath, JSON.stringify(sourceMap));
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[Injected](/projects/injected-route)\n');

  const result = run(root);
  assert.notEqual(result.status, 0, 'arbitrary mapped project route must not be approved');
  assert.match(result.stderr, /internal link '\/projects\/injected-route' is not an approved application route/i);
}));

test('rejects raw, escaped, and percent-encoded backslashes in link, image, and reference destinations', () => withFixture(root => {
  const page = target(root, 'content/pages/backslash-destinations.md');
  const cases = [
    '[raw](\\\\evil.example/path)',
    '[escaped](\\\\\\evil.example/path)',
    '[encoded](%5c%5cevil.example/path)',
    '![raw image](\\\\evil.example/image.png)',
    '![encoded image](%5C%5Cevil.example/image.png)',
    '[reference][bad]\n\n[bad]: %5c%5cevil.example/path'
  ];
  for (const [index, markdown] of cases.entries()) {
    fs.writeFileSync(page, [
      '---', `title: Backslash destination ${index}`, 'description: URL parser test', 'locale: sv-SE',
      'status: draft', 'type: page', '---', markdown, ''
    ].join('\n'));
    const result = run(root);
    assert.notEqual(result.status, 0, `accepted backslash destination: ${markdown}`);
    assert.match(result.stderr, /backslash.*destination|destination.*backslash/i);
  }
}));


test('resolves relative published links against their current page route', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[CV](cv) [this page](#overview) [encoded fragment](#overview%20section)\n');
  const lanternan = target(root, 'content/pages/projects/lanternan.md');
  fs.appendFileSync(lanternan, '\n\n[Another project](kompass) [Services](/services?view=all#contact)\n');

  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));

test('rejects invalid fragment-only links', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[Invalid fragment](#not#valid)\n');

  const result = run(root);
  assert.notEqual(result.status, 0, 'fragment-only links with an unescaped hash must be rejected');
  assert.match(result.stderr, /invalid fragment-only destination/i);
}));

test('rejects unknown relative links after resolving them against each published route', () => withFixture(root => {
  const lanternan = target(root, 'content/pages/projects/lanternan.md');
  fs.appendFileSync(lanternan, '\n\n[Unknown](../../unlisted-page)\n');

  const result = run(root);
  assert.notEqual(result.status, 0, 'unknown relative route must be rejected');
  assert.match(result.stderr, /internal link '\.\.\/\.\.\/unlisted-page' is not an approved application route/i);
}));

test('rejects nested encoded separators and backslashes in links, images, and reference destinations', () => withFixture(root => {
  const page = target(root, 'content/pages/nested-encoded-destinations.md');
  let excessiveNesting = '%5c%5cevil.example/path';
  for (let level = 0; level < 9; level += 1) excessiveNesting = excessiveNesting.replaceAll('%', '%25');
  const cases = [
    '[nested backslashes](%255c%255cevil.example/path)',
    '[case and extra levels](%2525255C%2525255Cevil.example/path)',
    `[too many encoding levels](${excessiveNesting})`,
    '![nested backslashes](%25255c%25255cevil.example/image.png)',
    '[reference][bad]\n\n[bad]: %2525252f%2525252fevil.example/path'
  ];
  for (const [index, markdown] of cases.entries()) {
    fs.writeFileSync(page, [
      '---', `title: Nested destination ${index}`, 'description: URL parser test', 'locale: sv-SE',
      'status: draft', 'type: page', '---', markdown, ''
    ].join('\n'));
    const result = run(root);
    assert.notEqual(result.status, 0, `accepted nested-encoded destination: ${markdown}`);
    assert.match(result.stderr, /backslash.*destination|protocol-relative destination|encoded separator.*path|invalid percent encoding/i);
  }
}));

test('fails closed on malformed percent encodings in links, images, and references', () => withFixture(root => {
  const page = target(root, 'content/pages/malformed-encoded-destinations.md');
  const cases = [
    '[malformed link](/cv%2)',
    '![malformed image](images/photo%GG.png)',
    '[reference][bad]\n\n[bad]: /cv%'
  ];
  for (const [index, markdown] of cases.entries()) {
    fs.writeFileSync(page, [
      '---', `title: Malformed destination ${index}`, 'description: URL parser test', 'locale: sv-SE',
      'status: draft', 'type: page', '---', markdown, ''
    ].join('\n'));
    const result = run(root);
    assert.notEqual(result.status, 0, `accepted malformed percent encoding: ${markdown}`);
    assert.match(result.stderr, /invalid percent encoding/i);
  }
}));

test('rejects encoded URL structure changes while validating original Markdown destinations', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, [
    '',
    '[encoded scheme](http%3A//app.invalid/cv)',
    '[encoded query delimiter](/cv%3Funexpected)',
    '[encoded fragment delimiter][encoded-hash]',
    '',
    '[encoded-hash]: /%23cv',
    ''
  ].join('\n'));

  const result = run(root);
  assert.notEqual(result.status, 0, 'encoded URL delimiters must not change the route being validated');
  assert.match(result.stderr, /internal link 'http%3A\/\/app\.invalid\/cv' is not an approved application route/i);
  assert.match(result.stderr, /internal link '\/cv%3Funexpected' is not an approved application route/i);
  assert.match(result.stderr, /internal link '\/%23cv' is not an approved application route/i);
}));

test('rejects encoded separators in URL paths for links, images, and reference destinations', () => withFixture(root => {
  const page = target(root, 'content/pages/encoded-path-separators.md');
  const cases = [
    '[encoded slash](/cv%2Funknown)',
    '[nested encoded slash](/cv%252Funknown)',
    '![encoded backslash](/images/photo%5C..png)',
    '[reference][bad]\n\n[bad]: /cv%252funknown'
  ];
  for (const [index, markdown] of cases.entries()) {
    fs.writeFileSync(page, [
      '---', `title: Encoded path separator ${index}`, 'description: URL parser test', 'locale: sv-SE',
      'status: draft', 'type: page', '---', markdown, ''
    ].join('\n'));
    const result = run(root);
    assert.notEqual(result.status, 0, `accepted encoded path separator in ${markdown}`);
    assert.match(result.stderr, /encoded separator.*path|path.*encoded separator/i);
  }
}));

test('preserves allowed external HTTPS and mailto links', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[External](https://example.test/profile) [Email](mailto:hello@example.test)\n');

  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));

test('allows absolute HTTPS links to approved same-site routes across www canonical hosts', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[CV](https://example.invalid:443/cv) [Projekt Lanternan](https://www.example.invalid/projects/lanternan)\n');

  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));

test('rejects same-site HTTPS links with empty userinfo delimiters', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  const destinations = [
    'https://@example.invalid/cv',
    'https://:@example.invalid/cv',
    'https://:@www.example.invalid/cv'
  ];
  fs.appendFileSync(home, `\n\n${destinations.map((url, index) => `[Userinfo ${index}](${url})`).join(' ')}\n`);

  const result = run(root);
  assert.notEqual(result.status, 0, 'same-site HTTPS links with empty userinfo must not be approved');
  assert.match(result.stderr, /internal link .* must not contain URL userinfo/i);
}));

test('rejects literal and encoded root-escaping dot segments before URL path normalization', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  const destinations = [
    '../cv',
    '%2e%2e/cv',
    '%252e%252e/cv',
    '%2e./cv',
    '.%2e/cv',
    '%2e%252e/cv',
    '%252e%2e/cv'
  ];
  fs.appendFileSync(home, `\n\n${destinations.map((url, index) => `[Dot segment ${index}](${url})`).join(' ')}\n`);

  const result = run(root);
  assert.notEqual(result.status, 0, 'dot segments must not be normalized into approved routes');
  assert.match(result.stderr, /dot path segment/i);
  for (const destination of destinations) {
    assert.match(result.stderr, new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
}));

test('preserves approved same-site routes and external HTTPS links under the URL policy', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[CV](https://example.invalid/cv) [External](https://example.test/profile)\n');

  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));

test('rejects absolute HTTPS links to unapproved routes on either canonical host', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[Unknown](https://example.invalid/unapproved) [Alias](https://www.example.invalid/also-unapproved)\n');

  const result = run(root);
  assert.notEqual(result.status, 0, 'same-site absolute HTTPS links must use an approved application route');
  assert.match(result.stderr, /internal link 'https:\/\/example\.invalid\/unapproved' is not an approved application route/i);
  assert.match(result.stderr, /internal link 'https:\/\/www\.example\.invalid\/also-unapproved' is not an approved application route/i);
}));

test('matches absolute-link origins by HTTPS scheme, effective port, and parsed hostname', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[Other port](https://example.invalid:444/unapproved) ' +
    '[Other scheme](http://example.invalid/unapproved) ' +
    '[External host](https://external.example/unapproved)\n');

  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));

test('rejects credentials in absolute same-site HTTPS links', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[Credential URL](https://user:secret@example.invalid/cv)\n');

  const result = run(root);
  assert.notEqual(result.status, 0, 'same-site URLs with userinfo must not be approved');
  assert.match(result.stderr, /userinfo|credentials|not an approved application route/i);
}));


test('rejects userinfo delimiters on external HTTPS destinations', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  const destinations = [
    'https://user@example.test/profile',
    'https://@example.test/profile',
    'https://:@example.test/profile'
  ];
  fs.appendFileSync(home, `\n\n${destinations.map((url, index) => `[External userinfo ${index}](${url})`).join(' ')}\n`);

  const result = run(root);
  assert.notEqual(result.status, 0, 'external links with any raw @ in their authority must be rejected');
  assert.match(result.stderr, /userinfo/i);
}));

test('rejects ambiguous web URL spellings before browser URL normalization', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  const destinations = [
    'https:/@example.test/cv',
    'https:/example.test/cv',
    'https:////example.test/cv',
    'https:\\\\example.test\\cv'
  ];
  fs.appendFileSync(home, `\n\n${destinations.map((url, index) => `[Ambiguous URL ${index}](${url})`).join(' ')}\n`);

  const result = run(root);
  assert.notEqual(result.status, 0, 'ambiguous HTTP(S) spellings must not be normalized into valid URLs');
  assert.match(result.stderr, /explicit http:\/\/ or https:\/\//i);
}));

test('rejects normalized absolute and relative dot segments before parsing web URLs', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  const destinations = [
    '/projects/../cv',
    '/projects/%2e%2e/cv',
    '/projects/%252e%252e/cv',
    'projects/../cv',
    'projects/%2e%2e/cv',
    'https://example.test/a/../profile',
    'https://example.test/a/%252e%252e/profile'
  ];
  fs.appendFileSync(home, `\n\n${destinations.map((url, index) => `[Dot variant ${index}](${url})`).join(' ')}\n`);

  const result = run(root);
  assert.notEqual(result.status, 0, 'all raw dot segments must be rejected before URL path normalization');
  assert.match(result.stderr, /dot path segment/i);
  for (const destination of destinations) {
    assert.match(result.stderr, new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
}));


test('rejects encoded reserved delimiters in raw absolute and relative paths', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  const destinations = [
    '/cv%3Funexpected',
    'cv%2523fragment',
    'https://example.test/profile%3Funexpected',
    'https://example.test/profile%2523fragment'
  ];
  fs.appendFileSync(home, `\n\n${destinations.map((url, index) => `[Reserved delimiter ${index}](${url})`).join(' ')}\n`);

  const result = run(root);
  assert.notEqual(result.status, 0, 'encoded reserved delimiters must be rejected before URL normalization');
  assert.match(result.stderr, /encoded reserved delimiter/i);
  for (const destination of destinations) {
    assert.match(result.stderr, new RegExp(destination.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
}));

test('rejects percent-encoded hostnames in link, image, and reference destinations', () => withFixture(root => {
  const draft = target(root, 'content/pages/encoded-authorities.md');
  const cases = [
    ['external link', '[encoded host](https://%65xample.com/cv)', '%65xample.com'],
    ['image', '![encoded host](https://%65xample.com/cv)', '%65xample.com'],
    ['reference destination', '[encoded host][encoded-host]\n\n[encoded-host]: https://%65xample.com/cv', '%65xample.com']
  ];
  for (const [label, markdown, authority] of cases) {
    fs.writeFileSync(draft, [
      '---', `title: Encoded authority ${label}`, 'description: URL parser test', 'locale: sv-SE',
      'status: draft', 'type: page', '---', markdown, ''
    ].join('\n'));
    const result = run(root);
    assert.notEqual(result.status, 0, `accepted percent-encoded authority in ${label}`);
    assert.match(result.stderr, /authority.*percent escape/i);
    assert.ok(result.stderr.includes(authority), `diagnostic should identify the rejected authority in ${label}`);
  }

  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[Encoded same-site hostname](https://%68ellmangroup.se/cv)\n');
  const sameSiteResult = run(root);
  assert.notEqual(sameSiteResult.status, 0, 'accepted a percent-encoded same-site hostname');
  assert.match(sameSiteResult.stderr, /authority.*percent escape/i);
  assert.match(sameSiteResult.stderr, /%68ellmangroup\.se/);
}));

test('rejects noncanonical HTTP authority spellings', () => withFixture(root => {
  const page = target(root, 'content/pages/noncanonical-authority.md');
  const cases = [
    '[Leading-zero port](https://example.test:0443/cv)',
    '[Trailing-dot same-site host](https://example.invalid./unapproved)'
  ];
  for (const [index, markdown] of cases.entries()) {
    fs.writeFileSync(page, [
      '---', `title: Noncanonical authority ${index}`, 'description: URL parser test', 'locale: sv-SE',
      'status: draft', 'type: page', '---', markdown, ''
    ].join('\n'));

    const result = run(root);
    assert.notEqual(result.status, 0, `accepted a noncanonical authority in ${markdown}`);
    assert.match(result.stderr, /authority is not in canonical form/i);
  }
}));

test('preserves canonical external HTTPS, plain relative, fragment, and mailto destinations', () => withFixture(root => {
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[External](https://example.test/profile) [Relative](cv) [Fragment](#overview) [Email](mailto:hello@example.test)\n');

  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));

test('uses a configured www siteUrl as canonical for non-www absolute links', () => withFixture(root => {
  const settingsPath = target(root, 'content/site.json');
  const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
  settings.siteUrl = 'https://www.example.invalid';
  fs.writeFileSync(settingsPath, JSON.stringify(settings));
  const home = target(root, 'content/pages/home.md');
  fs.appendFileSync(home, '\n\n[CV](https://example.invalid/cv) [Services](https://www.example.invalid/services)\n');

  const result = run(root);
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));


test('validates a project when links are omitted and checks links when present', () => withFixture(root => {
  const withoutLinks = addDocument(root, 'project', {
    summary: 'A project without a links field', technologies: '[TypeScript, Node.js]'
  });
  const accepted = run(root);
  assert.equal(accepted.status, 0, accepted.stderr || accepted.stdout);
  fs.unlinkSync(withoutLinks);

  const invalidLinks = addDocument(root, 'project', {
    summary: 'A project with invalid links', technologies: '[TypeScript, Node.js]', links: '[not, a, string]'
  });
  const rejected = run(root);
  assert.notEqual(rejected.status, 0);
  assert.match(rejected.stderr, /requires 'links' as a non-empty string/);
  fs.unlinkSync(invalidLinks);
}));

test('accepts a data root outside the current working directory', () => withFixture(root => {
  const result = spawnSync(process.execPath, [validatorPath, '--root', root], {
    cwd: repositoryRoot, encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));


test('rejects a symlinked Markdown page before reading outside the selected root', t => withFixture(root => {
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-validator-outside-'));
  try {
    const outsidePage = target(outsideRoot, 'outside.md');
    const page = target(root, 'content/pages/home.md');
    fs.writeFileSync(outsidePage, 'not valid Markdown frontmatter\n');
    fs.unlinkSync(page);
    if (!createSymlinkOrSkip(t, outsidePage, page, 'file')) return;

    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink|reparse point/i);
  } finally {
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
}));

test('rejects a symlinked pages root', t => withFixture(root => {
  const outsidePages = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-validator-pages-'));
  try {
    fs.writeFileSync(target(outsidePages, 'outside.md'), 'not valid Markdown frontmatter\n');
    const pages = target(root, 'content/pages');
    fs.rmSync(pages, { recursive: true, force: true });
    if (!createSymlinkOrSkip(t, outsidePages, pages, process.platform === 'win32' ? 'junction' : 'dir')) return;

    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink|reparse point/i);
  } finally {
    fs.rmSync(outsidePages, { recursive: true, force: true });
  }
}));

test('rejects a symlinked nested Markdown parent', t => withFixture(root => {
  const outsideProjects = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-validator-projects-'));
  try {
    fs.writeFileSync(target(outsideProjects, 'outside.md'), 'not valid Markdown frontmatter\n');
    const projects = target(root, 'content/pages/projects');
    fs.rmSync(projects, { recursive: true, force: true });
    if (!createSymlinkOrSkip(t, outsideProjects, projects, process.platform === 'win32' ? 'junction' : 'dir')) return;

    const result = run(root);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink|reparse point/i);
  } finally {
    fs.rmSync(outsideProjects, { recursive: true, force: true });
  }
}));

test('rejects non-regular Markdown paths before reading them', () => withFixture(root => {
  fs.mkdirSync(target(root, 'content/pages/folder.md'));
  const result = run(root);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Markdown path is not a regular file/i);
}));


test('rejects a page replaced through an outside parent during open', t => withFixture(root => {
  const outsidePages = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-validator-race-'));
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  const probe = target(root, 'symlink-probe');
  try {
    if (!createSymlinkOrSkip(t, outsidePages, probe, linkType)) return;
    fs.rmSync(probe, { recursive: true, force: true });
    const outsideHome = target(outsidePages, 'home.md');
    fs.writeFileSync(outsideHome, [
      '---', 'title: Outside home', 'description: Outside-root page', 'locale: sv-SE',
      'status: published', 'type: page', '---', 'Valid but outside the selected root.', ''
    ].join('\n'));

    const preload = target(root, 'parent-swap.cjs');
    fs.writeFileSync(preload, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const targetFile = path.resolve(process.env.PAGE_RACE_TARGET);',
      'const pagesRoot = path.resolve(process.env.PAGE_RACE_ROOT);',
      'const outsidePages = path.resolve(process.env.PAGE_RACE_OUTSIDE);',
      "const backup = pagesRoot + '-race-backup';",
      'const linkType = process.env.PAGE_RACE_LINK_TYPE;',
      'const originalOpenSync = fs.openSync;',
      'let swapped = false;',
      'fs.openSync = function (file, ...args) {',
      "  if (!swapped && typeof file === 'string' && path.resolve(file) === targetFile) {",
      '    swapped = true;',
      '    fs.renameSync(pagesRoot, backup);',
      '    let descriptor;',
      '    try {',
      '      fs.symlinkSync(outsidePages, pagesRoot, linkType);',
      '      descriptor = originalOpenSync.call(fs, file, ...args);',
      '    } finally {',
      '      fs.rmSync(pagesRoot, { recursive: true, force: true });',
      '      fs.renameSync(backup, pagesRoot);',
      '    }',
      '    return descriptor;',
      '  }',
      '  return originalOpenSync.call(fs, file, ...args);',
      '};'
    ].join('\n'));
    const result = spawnSync(process.execPath, ['--require', preload, validatorPath], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PAGE_RACE_TARGET: target(root, 'content/pages/home.md'),
        PAGE_RACE_ROOT: target(root, 'content/pages'),
        PAGE_RACE_OUTSIDE: outsidePages,
        PAGE_RACE_LINK_TYPE: linkType
      }
    });
    assert.notEqual(result.status, 0, 'accepted content opened through a swapped outside parent: ' + result.stderr);
    assert.match(result.stderr, /changed during validation|symlink|reparse point/i);
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
    fs.rmSync(outsidePages, { recursive: true, force: true });
  }
}));


test('rejects a pages directory swapped during enumeration', t => withFixture(root => {
  const outsidePages = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-validator-enumeration-'));
  const linkType = process.platform === 'win32' ? 'junction' : 'dir';
  const probe = target(root, 'enumeration-symlink-probe');
  try {
    if (!createSymlinkOrSkip(t, outsidePages, probe, linkType)) return;
    fs.rmSync(probe, { recursive: true, force: true });
    const preload = target(root, 'enumeration-swap.cjs');
    fs.writeFileSync(preload, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      'const pagesRoot = path.resolve(process.env.PAGE_RACE_ROOT);',
      'const outsidePages = path.resolve(process.env.PAGE_RACE_OUTSIDE);',
      "const backup = pagesRoot + '-enumeration-backup';",
      'const linkType = process.env.PAGE_RACE_LINK_TYPE;',
      'const originalReaddirSync = fs.readdirSync;',
      'let swapped = false;',
      'fs.readdirSync = function (directory, ...args) {',
      "  if (!swapped && typeof directory === 'string' && path.resolve(directory) === pagesRoot) {",
      '    swapped = true;',
      '    fs.renameSync(pagesRoot, backup);',
      '    try {',
      '      fs.symlinkSync(outsidePages, pagesRoot, linkType);',
      '      return originalReaddirSync.call(fs, directory, ...args);',
      '    } finally {',
      '      fs.rmSync(pagesRoot, { recursive: true, force: true });',
      '      fs.renameSync(backup, pagesRoot);',
      '    }',
      '  }',
      '  return originalReaddirSync.call(fs, directory, ...args);',
      '};'
    ].join('\n'));
    const result = spawnSync(process.execPath, ['--require', preload, validatorPath], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        PAGE_RACE_ROOT: target(root, 'content/pages'),
        PAGE_RACE_OUTSIDE: outsidePages,
        PAGE_RACE_LINK_TYPE: linkType
      }
    });
    assert.notEqual(result.status, 0, 'accepted an incomplete page list after parent replacement');
    assert.match(result.stderr, /directory changed during validation|symlink|reparse point/i);
  } finally {
    fs.rmSync(probe, { recursive: true, force: true });
    fs.rmSync(outsidePages, { recursive: true, force: true });
  }
}));


test('does not block if a Markdown file becomes a FIFO during open', t => {
  if (process.platform === 'win32') return t.skip('POSIX FIFO test is not available on Windows.');
  return withFixture(root => {
    const probe = target(root, 'fifo-probe');
    const probeResult = spawnSync('mkfifo', [probe], { encoding: 'utf8' });
    if (probeResult.error?.code === 'ENOENT' || probeResult.status !== 0) {
      return t.skip('mkfifo is not available on this platform.');
    }
    fs.unlinkSync(probe);

    const preload = target(root, 'fifo-swap.cjs');
    fs.writeFileSync(preload, [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      "const { spawnSync } = require('node:child_process');",
      'const targetFile = path.resolve(process.env.PAGE_FIFO_TARGET);',
      'const originalOpenSync = fs.openSync;',
      'let swapped = false;',
      'fs.openSync = function (file, ...args) {',
      "  if (!swapped && typeof file === 'string' && path.resolve(file) === targetFile) {",
      '    swapped = true;',
      '    fs.unlinkSync(file);',
      "    const created = spawnSync('mkfifo', [file]);",
      "    if (created.status !== 0) throw new Error('could not create test FIFO');",
      '    return originalOpenSync.call(fs, file, ...args);',
      '  }',
      '  return originalOpenSync.call(fs, file, ...args);',
      '};'
    ].join('\n'));
    const result = spawnSync(process.execPath, ['--require', preload, validatorPath], {
      cwd: root,
      encoding: 'utf8',
      timeout: 5000,
      env: { ...process.env, PAGE_FIFO_TARGET: target(root, 'content/pages/home.md') }
    });
    assert.equal(result.error, undefined, 'validation must not hang while opening a FIFO');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /not a regular file/i);
  });
});


test('rejects a site.json symlink outside the selected root', t => withFixture(root => {
  const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-validator-site-'));
  try {
    const outsideSite = target(outsideRoot, 'site.json');
    const site = target(root, 'content/site.json');
    fs.writeFileSync(outsideSite, JSON.stringify({
      supportedLocales: ['sv-SE'], contactEmail: 'alex@example.invalid', siteUrl: 'https://example.invalid'
    }));
    fs.unlinkSync(site);
    if (!createSymlinkOrSkip(t, outsideSite, site, 'file')) return;

    const result = spawnSync(process.execPath, [validatorPath, '--root', root], {
      cwd: repositoryRoot, encoding: 'utf8'
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /symlink|reparse point/i);
  } finally {
    fs.rmSync(outsideRoot, { recursive: true, force: true });
  }
}));

test('rejects a non-regular site.json path before reading it', () => withFixture(root => {
  const site = target(root, 'content/site.json');
  fs.unlinkSync(site);
  fs.mkdirSync(site);
  const result = spawnSync(process.execPath, [validatorPath, '--root', root], {
    cwd: repositoryRoot, encoding: 'utf8'
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /site.json.*not a regular file|not a regular file.*site.json/i);
}));

test('rejects a site.json FIFO without blocking on POSIX', t => {
  if (process.platform === 'win32') return t.skip('POSIX FIFO test is not available on Windows.');
  return withFixture(root => {
    const site = target(root, 'content/site.json');
    fs.unlinkSync(site);
    const created = spawnSync('mkfifo', [site], { encoding: 'utf8' });
    if (created.error?.code === 'ENOENT' || created.status !== 0) {
      return t.skip('mkfifo is not available on this platform.');
    }
    const result = spawnSync(process.execPath, [validatorPath, '--root', root], {
      cwd: repositoryRoot, encoding: 'utf8', timeout: 3000
    });
    assert.equal(result.error, undefined, 'validation must not block opening site.json FIFO');
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /site.json.*not a regular file|not a regular file.*site.json/i);
  });
});
