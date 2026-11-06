import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import MarkdownIt from 'markdown-it';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const syntheticFixturePath = path.join(repositoryRoot, 'scripts', 'content', 'fixtures', 'synthetic');
const syntheticPresentationFixturePath = path.join(repositoryRoot, 'scripts', 'content', 'fixtures', 'synthetic-presentation');
const generatedPages = [
  'content/pages/cv.md',
  'content/pages/home.md',
  'content/pages/services.md',
  'content/pages/projects.md',
  'content/pages/projects/kompass.md',
  'content/pages/projects/lanternan.md',
  'content/pages/projects/gron-stig.md'
];
const excludedPages = [
  'content/pages/profile.md',
  'content/pages/contact.md',
  'content/pages/demo-profile.md'
];
const transactionPath = '.content-generation.transaction.json';
const generationLockPath = '.cv-generation.lock';
const normalize = text => text.replace(/\r\n?/g, '\n');
const hash = data => createHash('sha256').update(data).digest('hex');
const target = (root, relativePath) => path.join(root, ...relativePath.split('/'));
const groupedCompetenceGroups = [
  {
    title: 'Bygga',
    sourceLines: ['Arkitektur, backend och integration.'],
    items: [
      { title: 'Lösningsarkitektur', sourceLines: ['Teknisk riktning nära implementation.'] },
      {
        title: 'Backend och integration',
        sourceLines: ['Backendutveckling, API:er och flöden mellan system.']
      }
    ]
  },
  {
    title: 'Leverera',
    sourceLines: ['Plattform, drift och modernisering.'],
    items: [{
      title: 'Plattform och modernisering',
      sourceLines: ['Stabil leverans och stegvis utveckling av befintliga lösningar.']
    }]
  },
  {
    title: 'Domän',
    sourceLines: ['Miljöer där kraven är höga.'],
    items: [{
      title: 'Offentlig sektor och reglerade miljöer',
      sourceLines: ['Informationskänsliga miljöer med krav på spårbarhet och behörighetsstyrning.']
    }]
  }
];
const groupedCompetenceSection = [
  '## Kompetensområden',
  '',
  'Systemdesign och teknisk riktning med praktiskt fokus.',
  '',
  '### Bygga',
  'Arkitektur, backend och integration.',
  '',
  '#### Lösningsarkitektur',
  'Teknisk riktning nära implementation.',
  '',
  '#### Backend och integration',
  'Backendutveckling, API:er och flöden mellan system.',
  '',
  '### Leverera',
  'Plattform, drift och modernisering.',
  '',
  '#### Plattform och modernisering',
  'Stabil leverans och stegvis utveckling av befintliga lösningar.',
  '',
  '### Domän',
  'Miljöer där kraven är höga.',
  '',
  '#### Offentlig sektor och reglerade miljöer',
  'Informationskänsliga miljöer med krav på spårbarhet och behörighetsstyrning.'
].join('\n');

function removeFixture(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function configureGroupedServices(root) {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const start = source.indexOf('## Kompetensområden\n');
  const end = source.indexOf('\n## ', start + 1);
  assert.ok(start >= 0 && end > start, 'competence source section should be present');
  fs.writeFileSync(
    sourcePath,
    `${source.slice(0, start)}${groupedCompetenceSection}${source.slice(end)}`
  );
  fs.appendFileSync(sourcePath, [
    '',
    '',
    '## Service hero evidence',
    '- Kompetens · syntetisk demo',
    '- Fyra delar i samma helhet',
    '- Kompetens med sammanhang.'
  ].join('\n'));
  const cvSectionsPath = target(root, 'content/cv-sections.json');
  const cvSections = JSON.parse(fs.readFileSync(cvSectionsPath, 'utf8'));
  cvSections.sections.push({ heading: 'Service hero evidence', required: false, publish: false });
  fs.writeFileSync(cvSectionsPath, `${JSON.stringify(cvSections, null, 2)}\n`);

  const mappingPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  const services = mapping.generatedPages.find(page => page.path === 'content/pages/services.md');
  delete services.competenceBlocks;
  services.competenceGroups = structuredClone(groupedCompetenceGroups);
  services.kicker = 'Kompetens · syntetisk demo';
  services.panelEyebrow = 'Fyra delar i samma helhet';
  services.panelTitle = 'Kompetens med sammanhang.';
  fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`);
}

function createFixture(fixturePath = syntheticFixturePath) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-content-generator-'));
  fs.cpSync(path.join(fixturePath, 'content'), target(root, 'content'), { recursive: true });
  fs.rmSync(target(root, 'content/generated-provenance.json'), { force: true });
  fs.mkdirSync(path.join(root, 'scripts', 'content'), { recursive: true });
  fs.symlinkSync(path.join(repositoryRoot, 'node_modules'), target(root, 'node_modules'), 'junction');

  const mapping = JSON.parse(fs.readFileSync(target(root, 'content/source-map.json'), 'utf8'));
  const baseline = 'known pre-generator page\n';
  mapping.bootstrapOutputSha256 = Object.fromEntries(generatedPages.map(page => [page, hash(baseline)]));
  fs.writeFileSync(target(root, 'content/source-map.json'), `${JSON.stringify(mapping, null, 2)}\n`);
  fs.copyFileSync(
    path.join(repositoryRoot, 'scripts', 'content', 'generate-content.mjs'),
    target(root, 'scripts/content/generate-content.mjs')
  );
  for (const page of generatedPages) fs.writeFileSync(target(root, page), baseline);
  for (const page of excludedPages) {
    fs.mkdirSync(path.dirname(target(root, page)), { recursive: true });
    fs.writeFileSync(target(root, page), `must remain untouched: ${page}\n`);
  }
  return root;
}

function createSymlinkOrSkip(t, targetPath, linkPath, type) {
  try {
    fs.symlinkSync(targetPath, linkPath, type);
    return true;
  } catch (error) {
    if (['EACCES', 'EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'UNKNOWN'].includes(error.code)) {
      t.skip(`Platform denied symlink creation (${error.code}).`);
      return false;
    }
    throw error;
  }
}

function createFifoOrSkip(t, fifoPath) {
  if (process.platform === 'win32') {
    t.skip('Named pipes are not available through mkfifo on Windows.');
    return false;
  }
  const result = spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' });
  if (result.error?.code === 'ENOENT') {
    t.skip('mkfifo is not available on this platform.');
    return false;
  }
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return true;
}

function createReadRaceAdapter(root, relativePath, mode, t) {
  const preload = target(root, 'scripts/read-race.cjs');
  const replacementPath = target(root, 'scripts/read-race-replacement');
  if (mode === 'replacement') {
    const originalPath = target(root, relativePath);
    fs.copyFileSync(originalPath, replacementPath);
    const stableTimestamp = new Date('2020-01-02T03:04:05.678Z');
    fs.utimesSync(originalPath, stableTimestamp, stableTimestamp);
    fs.utimesSync(replacementPath, stableTimestamp, stableTimestamp);

    const originalStats = fs.statSync(originalPath, { bigint: true });
    fs.chmodSync(replacementPath, Number(originalStats.mode & 0o7777n));
    const replacementStats = fs.statSync(replacementPath, { bigint: true });
    assert.deepEqual(fs.readFileSync(replacementPath), fs.readFileSync(originalPath));
    assert.equal(replacementStats.size, originalStats.size);
    assert.equal(replacementStats.mode, originalStats.mode);
    assert.equal(replacementStats.mtimeNs, originalStats.mtimeNs);
    assert.equal(replacementStats.dev, originalStats.dev);
    if (originalStats.ino === 0n || replacementStats.ino === 0n ||
        replacementStats.ino === originalStats.ino) {
      t.skip('Filesystem does not expose distinct inode identifiers for the replacement test.');
      return null;
    }
  }
  const adapter = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const { execFileSync } = require('node:child_process');",
    "const originalOpenSync = fs.openSync;",
    "let replaced = false;",
    "fs.openSync = function (file, ...args) {",
    "  if (!replaced && typeof file === 'string' && path.resolve(file) === path.resolve(process.env.CONTENT_READ_RACE_TARGET)) {",
    "    replaced = true;",
    "    fs.rmSync(file, { force: true });",
    "    if (process.env.CONTENT_READ_RACE_MODE === 'fifo') execFileSync('mkfifo', [file]);",
    "    else fs.renameSync(process.env.CONTENT_READ_RACE_REPLACEMENT, file);",
    "  }",
    "  return originalOpenSync.call(fs, file, ...args);",
    "};"
  ].join('\n');
  fs.writeFileSync(preload, adapter);
  return {
    preload,
    env: {
      CONTENT_READ_RACE_TARGET: target(root, relativePath),
      CONTENT_READ_RACE_REPLACEMENT: replacementPath,
      CONTENT_READ_RACE_MODE: mode
    }
  };
}

function run(root, mode, preload, envOverrides = {}, timeout) {
  const args = preload
    ? ['--require', preload, 'scripts/content/generate-content.mjs', mode]
    : ['scripts/content/generate-content.mjs', mode];
  return spawnSync(process.execPath, args, {
    cwd: root,
    encoding: 'utf8',
    env: preload
      ? { ...process.env, CONTENT_SYNC_TRACE: target(root, '.sync-trace'), ...envOverrides }
      : process.env,
    timeout
  });
}

function createSyncTraceAdapter(root) {
  const preload = target(root, 'scripts/sync-trace.cjs');
  const adapter = [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const logPath = process.env.CONTENT_SYNC_TRACE;",
    "const originalOpenSync = fs.openSync;",
    "const originalFsyncSync = fs.fsyncSync;",
    "const originalCloseSync = fs.closeSync;",
    "const originalLstatSync = fs.lstatSync;",
    "const originalUnlinkSync = fs.unlinkSync;",
    "const originalRmSync = fs.rmSync;",
    "const originalRenameSync = fs.renameSync;",
    "const originalAppendFileSync = fs.appendFileSync;",
    "const directoryDescriptors = new Map();",
    "const fileDescriptors = new Map();",
    "let journalRemoved = false;",
    "let journalRemovalFailureInjected = false;",
    "let generationLockRemoved = false;",
    "const relative = value => path.relative(process.cwd(), path.resolve(value)).split(path.sep).join('/') || '.';",
    "const record = value => originalAppendFileSync(logPath, `${value}\\n`);",
    "fs.openSync = function (file, ...args) {",
    "  let isDirectory = false;",
    "  try { isDirectory = originalLstatSync(file).isDirectory(); } catch {}",
    "  let descriptor;",
    "  try { descriptor = originalOpenSync.call(fs, file, ...args); }",
    "  catch (error) { if (isDirectory) record(`sync-open-error:${relative(file)}:${error.code}`); throw error; }",
    "  if (typeof file === 'string' || Buffer.isBuffer(file)) {",
    "    if (isDirectory) { record(`sync-open:${relative(file)}`); directoryDescriptors.set(descriptor, relative(file)); }",
    "    else fileDescriptors.set(descriptor, relative(file));",
    "  }",
    "  return descriptor;",
    "};",
    "fs.fsyncSync = function (descriptor, ...args) {",
    "  if (directoryDescriptors.has(descriptor)) record(`sync-fsync:${directoryDescriptors.get(descriptor)}`);",
    "  if (fileDescriptors.has(descriptor)) record(`file-fsync:${fileDescriptors.get(descriptor)}`);",
    "  if (process.env.CONTENT_FAIL_LOCK_FSYNC === '1' && fileDescriptors.get(descriptor) === '.cv-generation.lock') {",
    "    const error = new Error('simulated lock acquisition failure');",
    "    error.code = 'EIO';",
    "    throw error;",
    "  }",
    "  if (process.env.CONTENT_FAIL_POST_JOURNAL_FSYNC === '1' && journalRemoved && directoryDescriptors.get(descriptor) === '.') {",
    "    const error = new Error('simulated root fsync failure after journal removal');",
    "    error.code = 'EIO';",
    "    throw error;",
    "  }",
    "  if (process.env.CONTENT_FAIL_LOCK_RELEASE_SYNC === '1' && generationLockRemoved && directoryDescriptors.get(descriptor) === '.') {",
    "    const error = new Error('simulated lock release directory sync failure');",
    "    error.code = 'EIO';",
    "    throw error;",
    "  }",
    "  return originalFsyncSync.call(fs, descriptor, ...args);",
    "};",
    "fs.closeSync = function (descriptor, ...args) {",
    "  directoryDescriptors.delete(descriptor);",
    "  fileDescriptors.delete(descriptor);",
    "  return originalCloseSync.call(fs, descriptor, ...args);",
    "};",
    "fs.rmSync = function (file, ...args) {",
    "  if (process.env.CONTENT_FAIL_JOURNAL_REMOVE === '1' && relative(file) === '.content-generation.transaction.json' && !journalRemovalFailureInjected) {",
    "    journalRemovalFailureInjected = true;",
    "    const error = new Error('simulated journal removal failure');",
    "    error.code = 'EIO';",
    "    throw error;",
    "  }",
    "  const result = originalRmSync.call(fs, file, ...args);",
    "  record(`remove:${relative(file)}`);",
    "  if (relative(file) === '.content-generation.transaction.json') journalRemoved = true;",
    "  return result;",
    "};",
    "fs.unlinkSync = function (file, ...args) {",
    "  if (process.env.CONTENT_FAIL_LOCK_REMOVE === '1' && relative(file) === '.cv-generation.lock') {",
    "    const error = new Error('simulated lock removal failure');",
    "    error.code = 'EIO';",
    "    throw error;",
    "  }",
    "  const result = originalUnlinkSync.call(fs, file, ...args);",
    "  if (relative(file) === '.cv-generation.lock') generationLockRemoved = true;",
    "  return result;",
    "};",
    "fs.renameSync = function (from, to) {",
    "  const result = originalRenameSync.call(fs, from, to);",
    "  record(`rename:${relative(from)}->${relative(to)}`);",
    "  return result;",
    "};"
  ].join('\n');
  fs.writeFileSync(preload, adapter);
  return { preload, trace: target(root, '.sync-trace') };
}

async function startLockHolder(root) {
  const code = [
    "const fs = require('node:fs');",
    "fs.writeFileSync(process.argv[1], JSON.stringify({ pid: process.pid, token: require('node:crypto').randomUUID() }) + '\\n', { flag: 'wx' });",
    "process.stdout.write('READY\\n');",
    "process.stdin.resume();"
  ].join('\n');
  const child = spawn(process.execPath, ['-e', code, target(root, generationLockPath)], {
    stdio: ['pipe', 'pipe', 'pipe']
  });
  await new Promise((resolve, reject) => {
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk.toString('utf8');
      if (output.includes('READY')) resolve();
    });
    child.once('error', reject);
    child.once('exit', codeValue => reject(new Error(`Lock-holder exited before readiness: ${codeValue}`)));
  });
  return child;
}

function stopLockHolder(child) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise(resolve => {
    child.once('exit', resolve);
    child.kill();
  });
}

async function withFixture(t, callback, fixturePath = syntheticFixturePath) {
  const root = createFixture(fixturePath);
  try {
    return await callback(root);
  } finally {
    removeFixture(root);
  }
}

function injectWriteFault(root, action) {
  const scriptPath = target(root, 'scripts/content/generate-content.mjs');
  const script = fs.readFileSync(scriptPath, 'utf8');
  const writeLine = "      atomicReplace(entry.path, Buffer.from(entry.nextContent, 'base64'), previousContent, entry.stagedPath);";
  assert.ok(script.includes(writeLine), 'write operation should be present for fault injection');
  fs.writeFileSync(scriptPath, script.replace(
    writeLine,
    `${writeLine}\n      if (entry.path === 'content/pages/cv.md') ${action}`
  ));
}

function injectCrashAfterStage(root) {
  const scriptPath = target(root, 'scripts/content/generate-content.mjs');
  const script = fs.readFileSync(scriptPath, 'utf8');
  const renameLine = '    fs.renameSync(temporary, assertNoSymlinkPath(relativePath));';
  assert.ok(script.includes(renameLine), 'staged-file rename should be present for crash injection');
  fs.writeFileSync(scriptPath, script.replace(
    renameLine,
    "    if (relativePath === 'content/pages/cv.md') process.exit(86);\n" + renameLine
  ));
}

function injectExitAfterRecovery(root) {
  const scriptPath = target(root, 'scripts/content/generate-content.mjs');
  const script = fs.readFileSync(scriptPath, 'utf8');
  const recoveryLine = /^(  rollbackJournal\(journal\);)\r?$/m;
  assert.match(script, recoveryLine, 'recovery rollback should be present for exit injection');
  fs.writeFileSync(scriptPath, script.replace(recoveryLine, '$1\n  process.exit(86);'));
}

function stagedTemporaryFiles(root, directory = root) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return stagedTemporaryFiles(root, entryPath);
    return /\.content-generation-.*\.tmp$/.test(entry.name)
      ? [path.relative(root, entryPath)]
      : [];
  });
}

test('validates the canonical source and rejects malformed source', t => withFixture(t, root => {
  const valid = run(root, '--validate-source');
  assert.equal(valid.status, 0, valid.stderr);
  assert.match(valid.stdout, /Validated canonical source/);

  const sourcePath = target(root, 'content/sources/master-cv.md');
  fs.writeFileSync(sourcePath, fs.readFileSync(sourcePath, 'utf8').replace('## Översikt', '## Annan översikt'));
  const invalid = run(root, '--validate-source');
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Required source heading not found/);
}));

test('ignores section-like headings inside backtick and tilde fenced code blocks', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  let source = fs.readFileSync(sourcePath, 'utf8');
  const heading = source.split('\n').find(line => /^## /u.test(line));
  assert.ok(heading);
  source = source.replace(heading,
    `\`\`\`markdown\n## fake section\nfake backtick section\n\`\`\`\n\n~~~markdown\n## fake section\nfake tilde section\n~~~\n\n${heading}`);
  fs.writeFileSync(sourcePath, source);

  const validation = run(root, '--validate-source');
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  assert.equal(run(root, '--write').status, 0);
  const home = fs.readFileSync(target(root, 'content/pages/home.md'), 'utf8');
  assert.match(home, /^# .+$/m);
  assert.match(home, /Alex hjälper små team/);
}));

test('rejects duplicate section headings outside fenced code blocks', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  fs.appendFileSync(sourcePath, '\n\n## Översikt\nDuplicate section.\n');

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Ambiguous source section heading appears more than once/);
}));

test('rejects project facts and home tagline that exist only in inline code', async t => {
  const mutations = [
    {
      name: 'project period',
      update(source) { return source.replace(/(\*\*Period:\*\* )[^\r\n]+/u, '$1`period`'); },
      error: /Project source is missing period, role, summary, responsibilities, result or technologies/
    },
    {
      name: 'project role',
      update(source) { return source.replace('**Roll:** Lead utvecklare för digitala tjänster', '**Roll:** `Lead utvecklare för digitala tjänster`'); },
      error: /Project source is missing period, role, summary, responsibilities, result or technologies/
    },
    {
      name: 'project responsibilities',
      update(source) {
        const start = source.indexOf('### Projekt Kompass');
        const end = source.indexOf('\n#### Resultat', start);
        assert.ok(start >= 0 && end > start);
        const lines = source.slice(start, end).split('\n');
        const firstResponsibility = lines.findIndex(line => /^\s*[-*+]\s+/u.test(line));
        assert.ok(firstResponsibility >= 0);
        const section = lines.map((line, index) => index < firstResponsibility || !line.trim()
          ? line
          : `\`${line.trim()}\``).join('\n');
        return `${source.slice(0, start)}${section}${source.slice(end)}`;
      },
      error: /Project source is missing period, role, summary, responsibilities, result or technologies/
    },
    {
      name: 'project technologies',
      update(source) {
        const start = source.indexOf('#### Nyckelord', source.indexOf('### Projekt Kompass'));
        const end = source.indexOf('\n### ', start);
        assert.ok(start >= 0 && end > start);
        const section = source.slice(start, end).replace(/(#### Nyckelord\r?\n)([^\r\n]+)/u, '$1`$2`');
        return `${source.slice(0, start)}${section}${source.slice(end)}`;
      },
      error: /Project source is missing period, role, summary, responsibilities, result or technologies/
    },
    {
      name: 'project summary',
      update(source) {
        const start = source.indexOf('#### Resultat', source.indexOf('### Projekt Kompass'));
        const end = source.indexOf('\n#### Nyckelord', start);
        assert.ok(start >= 0 && end > start);
        const section = source.slice(start, end).replace(/^#### Resultat\r?\n([\s\S]+)$/u, (_, summary) => `#### Resultat\n\`${summary.trim()}\``);
        return `${source.slice(0, start)}${section}${source.slice(end)}`;
      },
      error: /Project summary lacks source evidence/
    },
    {
      name: 'home tagline',
      update(source, root) {
        const tagline = JSON.parse(fs.readFileSync(target(root, 'content/source-map.json'), 'utf8'))
          .generatedPages.find(page => page.path === 'content/pages/home.md').heroTagline;
        assert.ok(source.includes(tagline));
        return source.replace(tagline, `\`${tagline}\``);
      },
      error: /Home hero tagline is missing from source evidence/
    }
  ];

  for (const mutation of mutations) {
    await withFixture(t, root => {
      const sourcePath = target(root, 'content/sources/master-cv.md');
      const original = fs.readFileSync(sourcePath, 'utf8');
      const changed = mutation.update(original, root);
      assert.notEqual(changed, original, `${mutation.name} fixture must change source`);
      fs.writeFileSync(sourcePath, changed);
      for (const mode of ['--validate-source', '--write']) {
        const result = run(root, mode);
        assert.notEqual(result.status, 0, `${mode} accepted ${mutation.name} in inline code`);
        assert.match(result.stderr, mutation.error, `${mode} should explain missing visible evidence for ${mutation.name}`);
      }
    });
  }
});

test('emits only parsed visible project facts when source fields mix inline code and prose', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  let source = fs.readFileSync(sourcePath, 'utf8');
  const start = source.indexOf('### Projekt Kompass');
  const end = source.indexOf('\n### ', start + 1);
  assert.ok(start >= 0 && end > start);
  let project = source.slice(start, end);
  project = project
    .replace(/(\*\*Period:\*\* )([^\r\n]+)/u, '$1`UNSUPPORTED_PERIOD` $2')
    .replace('**Roll:** Lead utvecklare för digitala tjänster', '**Roll:** `UNSUPPORTED_ROLE` Lead utvecklare för digitala tjänster')
    .replace('Planering blev tydligare och återkommande uppgifter enklare att följa', '`UNSUPPORTED_SUMMARY` Planering blev tydligare och återkommande uppgifter enklare att följa')
    .replace('- Skapade en enkel tjänst med testbara gränssnitt.', '- `UNSUPPORTED_RESPONSIBILITY` Skapade en enkel tjänst med testbara gränssnitt.')
    .replace('TypeScript, Node.js, PostgreSQL, API', '`UNSUPPORTED_TECHNOLOGY`, TypeScript, Node.js, PostgreSQL, API');
  source = `${source.slice(0, start)}${project}${source.slice(end)}`;
  fs.writeFileSync(sourcePath, source);

  const validation = run(root, '--validate-source');
  assert.equal(validation.status, 0, validation.stderr || validation.stdout);
  const generation = run(root, '--write');
  assert.equal(generation.status, 0, generation.stderr || generation.stdout);

  const output = fs.readFileSync(target(root, 'content/pages/projects/kompass.md'), 'utf8');
  for (const hiddenFact of [
    'UNSUPPORTED_PERIOD', 'UNSUPPORTED_ROLE', 'UNSUPPORTED_SUMMARY',
    'UNSUPPORTED_RESPONSIBILITY', 'UNSUPPORTED_TECHNOLOGY'
  ]) assert.equal(output.includes(hiddenFact), false, `${hiddenFact} must not be emitted as a fact`);
  assert.match(output, /^\*\*Period:\*\* 2026 - .+$/m);
  assert.match(output, /^\*\*Roll:\*\* Lead utvecklare för digitala tjänster$/m);
  assert.match(output, /Planering blev tydligare och återkommande uppgifter enklare att följa/);
  assert.match(output, /Skapade en enkel tjänst med testbara gränssnitt/);
  assert.match(output, /^- Node.js$/m);
  assert.match(output, /^- TypeScript$/m);
}));

test('generated project headings and technology lists remain semantic Markdown AST nodes', t => withFixture(t, root => {
  const generation = run(root, '--write');
  assert.equal(generation.status, 0, generation.stderr || generation.stdout);
  const markdown = fs.readFileSync(target(root, 'content/pages/projects/kompass.md'), 'utf8')
    .replace(/^---\n[\s\S]*?\n---\n?/u, '');
  const tokens = new MarkdownIt('commonmark').parse(markdown, {});
  const headings = tokens.filter(token => token.type === 'heading_open');
  assert.equal(headings.filter(token => token.tag === 'h1').length, 1);
  assert.ok(headings.some(token => token.tag === 'h2'), 'project sections must be Markdown headings');
  assert.ok(tokens.some(token => token.type === 'bullet_list_open'), 'technologies must be a semantic Markdown list');
  assert.ok(tokens.some(token => token.type === 'list_item_open'), 'technology list must contain semantic list items');
}));
test('inline-code-only period followed by visible filler does not publish the hidden period', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const source = fs.readFileSync(sourcePath, 'utf8').replace(
    /(\*\*Period:\*\* )[^\r\n]+/u,
    '$1`2099 - 2100` unrelated filler'
  );
  fs.writeFileSync(sourcePath, source);
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const page = fs.readFileSync(target(root, 'content/pages/projects/kompass.md'), 'utf8');
  assert.match(page, /^\*\*Period:\*\* unrelated filler$/m);
  assert.doesNotMatch(page, /2099|2100/);
}));
test('counts visible link labels as home tagline evidence', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const tagline = JSON.parse(fs.readFileSync(target(root, 'content/source-map.json'), 'utf8'))
    .generatedPages.find(page => page.path === 'content/pages/home.md').heroTagline;
  const source = fs.readFileSync(sourcePath, 'utf8').replace(tagline, `[${tagline}](https://example.test/unrelated)`);
  fs.writeFileSync(sourcePath, source);
  const result = run(root, '--validate-source');
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));

test('link destinations do not count as home tagline evidence', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const tagline = JSON.parse(fs.readFileSync(target(root, 'content/source-map.json'), 'utf8'))
    .generatedPages.find(page => page.path === 'content/pages/home.md').heroTagline;
  const source = fs.readFileSync(sourcePath, 'utf8').replace(tagline, `[](https://example.test/${encodeURIComponent(tagline)})`);
  fs.writeFileSync(sourcePath, source);
  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Home hero tagline is missing from source evidence/);
}));

test('does not use indented code blocks as project responsibility evidence', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  let source = fs.readFileSync(sourcePath, 'utf8');
  const start = source.indexOf('### Projekt Kompass');
  const responsibilities = source.indexOf('- Skapade en enkel tjänst med testbara gränssnitt.', start);
  const end = source.indexOf('\n#### Resultat', responsibilities);
  assert.ok(start >= 0 && responsibilities > start && end > responsibilities);
  const codeBlock = source.slice(responsibilities, end).split('\n')
    .map(line => line.trim() ? `    ${line}` : line).join('\n');
  source = `${source.slice(0, responsibilities)}${codeBlock}${source.slice(end)}`;
  fs.writeFileSync(sourcePath, source);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Project source is missing period, role, summary, responsibilities, result or technologies: Projekt Kompass/);
}));

test('does not use indented code in Resultat as project detail summary evidence', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const source = fs.readFileSync(sourcePath, 'utf8').replace(
    /(#### Resultat\r?\n)(Planering blev tydligare och återkommande uppgifter enklare att följa[^\r\n]*)/u,
    '$1\n    $2'
  );
  fs.writeFileSync(sourcePath, source);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Project summary lacks source evidence: Projekt Kompass/);
}));

test('does not use indented code blocks as project technology evidence', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  let source = fs.readFileSync(sourcePath, 'utf8');
  const start = source.indexOf('#### Nyckelord', source.indexOf('### Projekt Kompass'));
  const end = source.indexOf('\n### Projekt Lanternan', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end).replace(/^(?!#### Nyckelord)(?=\S)/gmu, '    ');
  source = `${source.slice(0, start)}${block}${source.slice(end)}`;
  fs.writeFileSync(sourcePath, source);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Project source is missing period, role, summary, responsibilities, result or technologies: Projekt Kompass/);
}));

test('does not use indented code blocks as competence summary evidence', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const source = fs.readFileSync(sourcePath, 'utf8').replace(
    '- Systemdesign och teknisk riktning med praktiskt fokus',
    '    - Systemdesign och teknisk riktning med praktiskt fokus'
  );
  fs.writeFileSync(sourcePath, source);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Services competence block lacks source evidence: Systemdesign/);
}));

test('checks selected project summary proof against code-filtered Resultat source', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const mapping = JSON.parse(fs.readFileSync(target(root, 'content/source-map.json'), 'utf8'));
  const summary = mapping.generatedPages.find(page => page.path === 'content/pages/projects.md')
    .selectedProjects.find(project => project.section === 'Projekt Kompass').summary;
  const source = fs.readFileSync(sourcePath, 'utf8').replace(
    /(#### Resultat\r?\n)[\s\S]*?(?=\r?\n#### Nyckelord)/u,
    `$1    ${summary}\n`
  );
  fs.writeFileSync(sourcePath, source);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Project summary lacks source evidence: Projekt Kompass/);
}));

test('rejects project-card destinations outside exact generated project routes', t => withFixture(t, root => {
  const mappingPath = target(root, 'content/source-map.json');
  const invalidPaths = [
    'https://example.test/projects/lanternan',
    '/projects/../cv',
    '/projects/lanternan](https://example.test)',
    '//example.test/projects/lanternan',
    '/projects/lanternan?next=/cv',
    '/projects/lanternan%2f..%2fcv',
    'javascript:alert(1)',
    '/projects/unapproved'
  ];
  for (const invalidPath of invalidPaths) {
    const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
    mapping.generatedPages.find(page => page.path === 'content/pages/projects.md')
      .selectedProjects[0].path = invalidPath;
    fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`);
    const result = run(root, '--validate-source');
    assert.notEqual(result.status, 0, `accepted ${invalidPath}`);
    assert.match(result.stderr, /Project destination must be an approved internal project route/);
  }
}));

test('does not treat raw HTML H1 text inside inline code as a real H1', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  fs.appendFileSync(sourcePath, '\nExample inline code: `<h1>` should remain literal text.\n');

  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr);
}));

test('escaped backticks cannot hide raw HTML H1 from validation', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  fs.appendFileSync(sourcePath, '\nExample \\`<h1>Raw heading</h1>\\` text.\n');

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0, 'escaped backticks are text, so raw HTML H1 remains detectable');
  assert.match(result.stderr, /raw HTML is not allowed/i);
}));

test('writes deterministically, checks exact outputs and records all hashes', t => withFixture(t, root => {
  const excludedBefore = excludedPages.map(page => fs.readFileSync(target(root, page), 'utf8'));
  const bootstrap = run(root, '--write');
  assert.equal(bootstrap.status, 0, bootstrap.stderr);
  assert.equal(fs.existsSync(target(root, generationLockPath)), false);
  assert.equal(fs.existsSync(target(root, transactionPath)), false);
  assert.equal(fs.existsSync(target(root, `${transactionPath}.tmp`)), false);

  const firstPages = generatedPages.map(page => fs.readFileSync(target(root, page)));
  const firstProvenance = fs.readFileSync(target(root, 'content/generated-provenance.json'));
  assert.equal(run(root, '--check').status, 0);
  assert.equal(run(root, '--write').status, 0);
  assert.deepEqual(generatedPages.map(page => fs.readFileSync(target(root, page))), firstPages);
  assert.deepEqual(fs.readFileSync(target(root, 'content/generated-provenance.json')), firstProvenance);

  const provenance = JSON.parse(firstProvenance);
  const { provenanceSha256, ...unsignedProvenance } = provenance;
  assert.equal(provenanceSha256, hash(JSON.stringify(unsignedProvenance)));
  const source = normalize(fs.readFileSync(target(root, provenance.source), 'utf8'));
  const mapping = normalize(fs.readFileSync(target(root, provenance.sourceMap), 'utf8'));
  const generator = normalize(fs.readFileSync(target(root, provenance.generator), 'utf8'));
  assert.equal(provenance.sourceSha256, hash(source));
  assert.equal(provenance.sourceMapSha256, hash(mapping));
  assert.equal(provenance.generatorSha256, hash(generator));
  assert.deepEqual(provenance.generatedPages, generatedPages);
  assert.deepEqual(Object.keys(provenance.outputSha256), generatedPages);
  for (const page of generatedPages) assert.equal(provenance.outputSha256[page], hash(fs.readFileSync(target(root, page))));

  assert.deepEqual(excludedPages.map(page => fs.readFileSync(target(root, page), 'utf8')), excludedBefore);
  const pageFiles = fs.readdirSync(target(root, 'content/pages'), { recursive: true })
    .filter(file => file.endsWith('.md'))
    .map(file => `content/pages/${file.replaceAll(path.sep, '/')}`)
    .sort();
  assert.deepEqual(pageFiles, [...generatedPages, ...excludedPages].sort());
  assert.equal(provenance.source, 'content/sources/master-cv.md');
  assert.equal(provenance.generatedPages.includes('content/pages/profile.md'), false);
}));

test('accepts CRLF checkouts while validating and writing generated outputs', t => withFixture(t, root => {
  assert.equal(run(root, '--write').status, 0);
  for (const page of generatedPages) {
    const pathToPage = target(root, page);
    const lf = fs.readFileSync(pathToPage, 'utf8');
    fs.writeFileSync(pathToPage, lf.replace(/\n/g, '\r\n'));
  }
  assert.equal(run(root, '--check').status, 0);
  assert.equal(run(root, '--write').status, 0);
  for (const page of generatedPages) {
    assert.ok(fs.readFileSync(target(root, page)).includes(Buffer.from('\r\n')), `${page} should preserve CRLF`);
  }
}));

test('generates editorial pages with exactly one real H1 and complete sections', t => withFixture(t, root => {
  assert.equal(run(root, '--write').status, 0);
  const publishedPages = generatedPages.filter(page => page !== 'content/pages/cv.md');
  for (const page of publishedPages) {
    const markdown = fs.readFileSync(target(root, page), 'utf8');
    const body = markdown.split(/^---\s*$/m).slice(2).join('\n');
    const visibleLines = [];
    let fence;
    for (const line of body.split('\n')) {
      const opener = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (fence) {
        const closer = line.match(/^\s{0,3}(`+|~+)\s*$/);
        if (closer && closer[1][0] === fence.character && closer[1].length >= fence.length) fence = undefined;
        continue;
      }
      if (opener) { fence = { character: opener[1][0], length: opener[1].length }; continue; }
      visibleLines.push(line);
    }
    assert.equal(visibleLines.filter(line => /^#\s+/.test(line)).length, 1, page);
  }
  const home = fs.readFileSync(target(root, 'content/pages/home.md'), 'utf8');
  assert.match(home, /^# .+$/m);
  assert.doesNotMatch(home, /^## /m);
  assert.match(home, /Alex hjälper små team/);
  const services = fs.readFileSync(target(root, 'content/pages/services.md'), 'utf8');
  assert.match(services, /^## Systemdesign$/m);
  assert.match(services, /^## API:er$/m);
  assert.match(services, /\[L.s hela CV:t\]\(\/cv\)/);
  const overview = fs.readFileSync(target(root, 'content/pages/projects.md'), 'utf8');
  assert.match(overview, /^- \[[^\]]+\]\(\/projects\/kompass\)\n  \S/m);
  assert.match(overview, /Planering blev tydligare/);
}));

test('keeps flat service mappings byte-identical when grouped metadata is absent', t => withFixture(t, root => {
  const expected = fs.readFileSync(target(syntheticFixturePath, 'content/pages/services.md'));
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(fs.readFileSync(target(root, 'content/pages/services.md')), expected);
}));

test('generates grouped service sections and optional hero metadata from source mappings', t => withFixture(t, root => {
  configureGroupedServices(root);
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const services = fs.readFileSync(target(root, 'content/pages/services.md'), 'utf8');
  for (const [field, value] of [
    ['kicker', 'Kompetens · syntetisk demo'],
    ['panelEyebrow', 'Fyra delar i samma helhet'],
    ['panelTitle', 'Kompetens med sammanhang.']
  ]) {
    assert.match(services, new RegExp(`^${field}:`, 'm'));
    assert.ok(services.includes(value), `${field} should be rendered from the mapping`);
  }
  assert.match(services, /^## Bygga\n\nArkitektur, backend och integration\.$/m);
  assert.match(services, /^### Lösningsarkitektur\n\nTeknisk riktning nära implementation\.$/m);
  assert.match(services, /^### Backend och integration\n\nBackendutveckling, API:er och flöden mellan system\.$/m);
  assert.match(services, /^## Leverera\n\nPlattform, drift och modernisering\.$/m);
  assert.match(services, /^### Plattform och modernisering\n\nStabil leverans och stegvis utveckling av befintliga lösningar\.$/m);
  assert.match(services, /^## Domän\n\nMiljöer där kraven är höga\.$/m);
  assert.match(services, /^### Offentlig sektor och reglerade miljöer\n\nInformationskänsliga miljöer med krav på spårbarhet och behörighetsstyrning\.$/m);
  assert.doesNotMatch(services, /^## Systemdesign$/m);
  const cv = fs.readFileSync(target(root, 'content/pages/cv.md'), 'utf8');
  assert.doesNotMatch(cv, /Service hero evidence/);
}));

test('rejects nested service list evidence when mapped as a standalone source line', t => withFixture(t, root => {
  configureGroupedServices(root);
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const originalItem = '#### Lösningsarkitektur\nTeknisk riktning nära implementation.';
  assert.ok(source.includes(originalItem), 'mapped source item should be present');
  fs.writeFileSync(sourcePath, source.replace(
    originalItem,
    '#### Lösningsarkitektur\n- Arkitekturen formas av användningsfallet.\n  - Teknisk riktning nära implementation.'
  ));

  const mappingPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  mapping.generatedPages.find(page => page.path === 'content/pages/services.md')
    .competenceGroups[0].items[0].sourceLines = ['- Teknisk riktning nära implementation.'];
  fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /nested list item cannot be mapped independently/i);
}));

test('requires source evidence for configured service hero metadata', t => withFixture(t, root => {
  configureGroupedServices(root);
  const mappingPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  mapping.generatedPages.find(page => page.path === 'content/pages/services.md')
    .panelTitle = 'Unsupported service promise.';
  fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Services hero metadata lacks source evidence: panelTitle/);
}));

test('rejects grouped service evidence outside its mapped group and item', t => withFixture(t, root => {
  configureGroupedServices(root);
  const mappingPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  const services = mapping.generatedPages.find(page => page.path === 'content/pages/services.md');
  services.competenceGroups[0].items[0].sourceLines = ['Plattform, drift och modernisering.'];
  fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Services competence item lacks source evidence: Bygga \/ Lösningsarkitektur/);
}));

test('rejects grouped service headings outside the configured competence section', t => withFixture(t, root => {
  configureGroupedServices(root);
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const movedGroups = groupedCompetenceSection.replace('## Kompetensområden\n\n', '');
  fs.writeFileSync(sourcePath, source.replace(
    groupedCompetenceSection,
    `## Kompetensområden\n\nÖversikt över syntetiska kompetenser.\n\n## Extra material\n\n${movedGroups}`
  ));

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required source heading not found: ### Bygga/);
}));

test('generates project details with source-backed structure and reflowed prose', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const source = fs.readFileSync(sourcePath, 'utf8').replace('Kompass är ett planeringsverktyg', 'Kompass är ett `planeringsverktyg`');
  assert.notEqual(source, fs.readFileSync(sourcePath, 'utf8'));
  fs.writeFileSync(sourcePath, source);
  assert.equal(run(root, '--write').status, 0);
  const kompass = fs.readFileSync(target(root, 'content/pages/projects/kompass.md'), 'utf8');
  assert.match(kompass, /^# .+$/m);
  assert.match(kompass, /^\*\*Period:\*\* 2026 -/m);
  assert.match(kompass, /^\*\*Roll:\*\* Lead utvecklare/m);
  assert.match(kompass, /^## Sammanfattning$/m);
  assert.match(kompass, /^## Ansvar och genomf.rande$/m);
  assert.match(kompass, /^## Resultat$/m);
  assert.match(kompass, /^## Teknik$/m);
  assert.match(kompass, /Kompass är ett för små föreningar/);
  assert.doesNotMatch(kompass, /planeringsverktyg/);
  assert.doesNotMatch(kompass, /Kompass är ett planeringsverktyg för små föreningar\n/);
  assert.match(kompass, /PostgreSQL/);
  assert.match(kompass, /Planering blev tydligare/);
  for (const page of ['lanternan.md', 'gron-stig.md']) {
    const body = fs.readFileSync(target(root, `content/pages/projects/${page}`), 'utf8');
    assert.doesNotMatch(body, /\\\s*$/m, `${page} should not retain source hard-break markers`);
    for (const heading of ['# ', '## Sammanfatt', '## Ansvar', '## Resultat', '## Teknik']) {
      assert.ok(body.includes(heading), `${page} should contain ${heading}`);
    }
  }
}));

test('keeps legacy generated page bytes unchanged without project presentation opt-in', t => withFixture(t, root => {
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr || result.stdout);

  for (const page of generatedPages) {
    assert.deepEqual(
      fs.readFileSync(target(root, page)),
      fs.readFileSync(target(syntheticFixturePath, page)),
      `legacy output changed without presentation metadata: ${page}`
    );
  }
}));

test('generates and checks the checked-in synthetic project presentation fixture', t => withFixture(t, root => {
  const generated = run(root, '--write');
  assert.equal(generated.status, 0, generated.stderr || generated.stdout);

  const checked = run(root, '--check');
  assert.equal(checked.status, 0, checked.stderr || checked.stdout);
  const output = fs.readFileSync(target(root, 'content/pages/projects/kompass.md'), 'utf8');
  assert.match(output, /^order: 1$/m);
  assert.match(output, /^period: "2026 - pågående"$/m);
  assert.match(output, /^role: "Lead utvecklare för digitala tjänster"$/m);
  assert.match(output, /^industry: "Föreningsliv"$/m);
}, syntheticPresentationFixturePath));

test('generates opt-in project facts from exact source evidence and applies editorial order', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const project = mapping.generatedPages.find(page => page.path === 'content/pages/projects/kompass.md');
  project.presentation = { order: 4, facts: ['period', 'role', 'industry'] };
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');

  const sourcePath = target(root, 'content/sources/master-cv.md');
  let source = fs.readFileSync(sourcePath, 'utf8');
  source = source.replace(
    '**Roll:** Lead utvecklare för digitala tjänster',
    '**Roll:** Lead utvecklare för digitala tjänster\n**Bransch:** Föreningsliv'
  );
  fs.writeFileSync(sourcePath, source);

  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = fs.readFileSync(target(root, project.path), 'utf8');
  assert.match(output, /^order: 4$/m);
  assert.match(output, /^period: "2026 - pågående"$/m);
  assert.match(output, /^role: "Lead utvecklare för digitala tjänster"$/m);
  assert.match(output, /^industry: "Föreningsliv"$/m);
  assert.doesNotMatch(output, /^\*\*Period:\*\* 2026 - pågående$/m);
  assert.doesNotMatch(output, /^\*\*Roll:\*\* Lead utvecklare för digitala tjänster$/m);
}));

test('rejects opt-in project facts without matching source evidence', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  mapping.generatedPages.find(page => page.path === 'content/pages/projects/kompass.md')
    .presentation = { facts: ['industry'] };
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Project industry presentation lacks source evidence: Projekt Kompass/);
}));

test('accepts the greatest project presentation order below the unordered sentinel', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  mapping.generatedPages.find(page => page.path === 'content/pages/projects/kompass.md')
    .presentation = { order: 2147483646 };
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');

  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const output = fs.readFileSync(target(root, 'content/pages/projects/kompass.md'), 'utf8');
  assert.match(output, /^order: 2147483646$/m);
}));

test('rejects the reserved unordered sentinel as a project presentation order', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  mapping.generatedPages.find(page => page.path === 'content/pages/projects/kompass.md')
    .presentation = { order: 2147483647 };
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Project presentation order must be a non-negative integer below Int32\.MaxValue/);
}));

test('fails closed when a mapped project summary is missing from source evidence', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  let source = fs.readFileSync(sourcePath, 'utf8');
  source = source.replace('Planering blev tydligare och återkommande uppgifter enklare att följa', 'Planering blev tydligare med en ny formulering för medlemmar.');
  fs.writeFileSync(sourcePath, source);
  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /summary.*source evidence|source evidence.*summary/i);
}));

test('does not count Setext-like lines after thematic breaks or indented code as H1s', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const source = fs.readFileSync(sourcePath, 'utf8');
  fs.writeFileSync(sourcePath, `${source}\n\n***\n===\n\n    indented code\n===\n\n` +
    `\`\`\`markdown\n> \`\`\`\n> # fenced blockquote heading\n\`\`\`\n\n` +
    `> \`\`\`markdown\n> > \`\`\`\n> # fenced quote heading\n> \`\`\``);
  const result = run(root, '--validate-source');
  assert.equal(result.status, 0, result.stderr || result.stdout);
}));

test('counts blockquote ATX and Setext H1s when enforcing exactly one H1', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const source = fs.readFileSync(sourcePath, 'utf8');
  for (const blockquoteHeading of [
    '> # Extra heading',
    '> Setext extra heading\n> ===',
  ]) {
    fs.writeFileSync(sourcePath, `${source}\n\n${blockquoteHeading}\n`);
    const result = run(root, '--validate-source');
    assert.notEqual(result.status, 0, `expected extra blockquote H1 to fail: ${blockquoteHeading}`);
    assert.match(result.stderr, /exactly one Markdown H1/i);
  }
}));

test('fails closed when raw HTML could add another rendered H1', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  fs.appendFileSync(sourcePath, '\n\n<h1>Extra rendered heading</h1>\n');
  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0, 'raw HTML H1 must not evade the exact-one rendered-H1 check');
  assert.match(result.stderr, /raw HTML is not allowed/i);
}));

test('rejects non-string scalar metadata values', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const baseline = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const cases = [
    ['content/pages/home.md', 'title', ['Array title']],
    ['content/pages/home.md', 'description', ['Array description']],
    ['content/pages/home.md', 'heroTagline', ['Array tagline']],
    ['content/pages/projects/lanternan.md', 'summary', ['Array summary']],
    ['content/pages/projects/lanternan.md', 'links', ['Array links']],
    ['content/pages/projects/lanternan.md', 'links', ''],
    ['content/pages/projects/lanternan.md', 'sourceHeading', 42],
    ['content/pages/home.md', 'sourceSection', ['Array section']],
    ['content/pages/home.md', 'type', ['page']],
    ['content/pages/home.md', 'locale', ['sv-SE']],
    ['content/pages/home.md', 'status', ['published']],
    ['content/pages/services.md', 'kicker', ['Array kicker']],
    ['content/pages/services.md', 'panelTitle', 'Multiple\nlines'],
    ['content/pages/services.md', 'competenceBlocks', [
      { title: ['Array title'], sourceLines: ['- source'] }
    ]],
    ['content/pages/projects.md', 'selectedProjects', [
      { section: 'Projekt Kompass', path: 3, summary: 'A valid source-backed summary.' }
    ]]
  ];
  for (const [pagePath, field, invalidValue] of cases) {
    const mapping = structuredClone(baseline);
    mapping.generatedPages.find(page => page.path === pagePath)[field] = invalidValue;
    fs.writeFileSync(mapPath, `${JSON.stringify(mapping, null, 2)}\n`);
    const result = run(root, '--validate-source');
    assert.notEqual(result.status, 0, `${pagePath}.${field} should reject ${JSON.stringify(invalidValue)}`);
    assert.ok(result.stderr.includes(field), `failure should identify ${pagePath}.${field}: ${result.stderr}`);
    assert.match(result.stderr,
      /must be a non-empty string|must be a string|must be a non-empty single-line string|links must be a non-empty string|must contain titled blocks|must contain string section/i);
  }
}));

test('creates fixtures under the OS temp directory and removes them after completion', async t => {
  let fixturePath;
  const completedPath = await withFixture(t, root => {
    fixturePath = root;
    const relative = path.relative(os.tmpdir(), root);
    assert.notEqual(relative, '..');
    assert.ok(!relative.startsWith(`..${path.sep}`), `fixture should be in OS temp directory: ${root}`);
    assert.ok(path.isAbsolute(root));
    return root;
  });
  assert.equal(completedPath, fixturePath);
  assert.equal(fs.existsSync(fixturePath), false, 'fixture should be removed after callback completes');
});

test('validates generated H1 counts while ignoring headings inside fenced code', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const originalSource = fs.readFileSync(sourcePath, 'utf8');
  let source = originalSource;
  const sourceLine = source.split('\n').find(line => /planeringsverktyg/u.test(line));
  assert.ok(sourceLine, 'project summary source line should exist');
  source = source.replace(sourceLine, `\`\`\`markdown\n# Sample heading\n\`\`\`\n\n${sourceLine}`);
  fs.writeFileSync(sourcePath, source);
  const fenced = run(root, '--validate-source');
  assert.equal(fenced.status, 0, fenced.stderr);

  fs.writeFileSync(sourcePath, originalSource);
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  mapping.generatedPages.find(page => page.path === 'content/pages/projects/kompass.md').title =
    'Projekt Kompass project\n# Unexpected second heading';
  fs.writeFileSync(mapPath, `${JSON.stringify(mapping, null, 2)}\n`);
  const duplicate = run(root, '--validate-source');
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /canonical source heading|exactly one Markdown H1/i);
}));

test('rejects duplicate source H1s in ATX-with-tab and Setext forms outside fences', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const originalSource = fs.readFileSync(sourcePath, 'utf8');
  for (const duplicate of ['#\tDuplicate source heading', 'Duplicate source heading\n===']) {
    fs.writeFileSync(sourcePath, `${originalSource}\n\n${duplicate}\n`);
    const result = run(root, '--validate-source');
    assert.notEqual(result.status, 0, `expected duplicate H1 to fail: ${JSON.stringify(duplicate)}`);
    assert.match(result.stderr, /exactly one Markdown H1/i);
  }
  fs.writeFileSync(sourcePath, `${originalSource}\n\n~~~markdown\n#\tCode heading\nCode setext\n===\n~~~\n`);
  const fenced = run(root, '--validate-source');
  assert.equal(fenced.status, 0, fenced.stderr);
}));

test('rejects unsupported locale and status before writing generated outputs', t => withFixture(t, root => {
  for (const [field, value] of [['locale', 'en-US'], ['status', 'archived']]) {
    const mapPath = target(root, 'content/source-map.json');
    const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    mapping.generatedPages.find(page => page.path === 'content/pages/home.md')[field] = value;
    fs.writeFileSync(mapPath, `${JSON.stringify(mapping, null, 2)}\n`);
    const result = run(root, '--write');
    assert.notEqual(result.status, 0, `${field}=${value} should be rejected`);
    assert.match(result.stderr, field === 'locale' ? /unsupported locale/i : /status must be 'draft' or 'published'/i);
    for (const page of generatedPages) assert.equal(fs.readFileSync(target(root, page), 'utf8'), 'known pre-generator page\n');
    assert.equal(fs.existsSync(target(root, 'content/generated-provenance.json')), false);
    mapping.generatedPages.find(page => page.path === 'content/pages/home.md')[field] = field === 'locale' ? 'sv-SE' : 'published';
    fs.writeFileSync(mapPath, `${JSON.stringify(mapping, null, 2)}\n`);
  }
}));

test('ignores project metadata and responsibilities inside fenced code as evidence', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  let source = fs.readFileSync(sourcePath, 'utf8');
  source = source.replace(/(^### Projekt Kompass[^\r\n]*\r?\n)/mu, heading =>
    `${heading}\`\`\`markdown\r\n**Period:** 2099 - fabricated\r\n**Roll:** Fabricated role\r\n` +
    '- Fabricated responsibility that is not a project fact.\r\n```\r\n');
  assert.match(source, /Fabricated responsibility that is not a project fact/);
  fs.writeFileSync(sourcePath, source);
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr);
  const project = fs.readFileSync(target(root, 'content/pages/projects/kompass.md'), 'utf8');
  assert.match(project, /^\*\*Period:\*\* 2026 - pågående$/m);
  assert.match(project, /^\*\*Roll:\*\* Lead utvecklare/m);
  assert.doesNotMatch(project, /2099 - fabricated|Fabricated role|Fabricated responsibility/);
}));

test('generates name and role as separate home and CV content', t => withFixture(t, root => {
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr);
  const home = fs.readFileSync(target(root, 'content/pages/home.md'), 'utf8');
  const cv = fs.readFileSync(target(root, 'content/pages/cv.md'), 'utf8');
  assert.match(home, /^# Alex Exempel\n\nSenior lösningsarkitekt och utvecklare\n\nAlex hjälper små team/m);
  assert.match(cv, /^# Alex Exempel\nSenior lösningsarkitekt och utvecklare\n\n## Roller/m);
  assert.doesNotMatch(home, /^## /m);
  assert.match(fs.readFileSync(target(root, 'content/pages/projects/kompass.md'), 'utf8'), /^## Ansvar och genomf.rande$/m);
}));

test('requires the canonical CV to begin with a name H1 followed by a role paragraph', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const source = fs.readFileSync(sourcePath, 'utf8').replace(/^# Alex Exempel/m, '## Alex Exempel');
  fs.writeFileSync(sourcePath, source);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Canonical CV must begin with a name H1 followed by a separate role paragraph/);
}));

test('rejects a missing role paragraph after the canonical name H1', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const source = fs.readFileSync(sourcePath, 'utf8').replace(/^Senior lösningsarkitekt och utvecklare\r?\n/m, '');
  fs.writeFileSync(sourcePath, source);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Canonical CV must begin with a name H1 followed by a separate role paragraph/);
}));

test('derives combined home title metadata from the canonical name and role', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  mapping.generatedPages.find(page => page.path === 'content/pages/home.md').title = 'Unrelated title';
  fs.writeFileSync(mapPath, `${JSON.stringify(mapping, null, 2)}\n`);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Home hero title metadata must match the canonical CV name and role/);
}));

test('rejects malformed CV publication override values', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const override = mapping.generatedPages.find(page => page.path === 'content/pages/cv.md')
    .approvedCvPublicationText.employmentLine;
  for (const field of ['source', 'published']) {
    const original = override[field];
    override[field] = [original];
    fs.writeFileSync(mapPath, `${JSON.stringify(mapping, null, 2)}\n`);
    const result = run(root, '--validate-source');
    assert.notEqual(result.status, 0, `employmentLine.${field} must be a string`);
    assert.match(result.stderr, /Invalid CV publication text mapping/);
    override[field] = original;
  }
}));

test('rejects line separators in the CV employment publication override', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const originalMapping = fs.readFileSync(mapPath, 'utf8');
  const separators = '\r\n\v\f\u0085\u2028\u2029';
  const mapping = JSON.parse(originalMapping);
  const override = mapping.generatedPages.find(page => page.path === 'content/pages/cv.md')
    .approvedCvPublicationText.employmentLine;

  for (const field of ['source', 'published']) {
    const originalValue = override[field];
    override[field] = `${originalValue}${separators}`;
    fs.writeFileSync(mapPath, `${JSON.stringify(mapping, null, 2)}\n`);
    const result = run(root, '--validate-source');
    assert.notEqual(result.status, 0, `employmentLine.${field} line separators must be rejected`);
    override[field] = originalValue;
  }
}));

test('rejects an employment literal found only in fenced text', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const employmentLine = '- Konsult hos Exempel Konsult AB, 2022 - pågående';
  const source = fs.readFileSync(sourcePath, 'utf8')
    .replace(employmentLine, '')
    .replace(
      /(^## Anställningar\r?\n)/m,
      `## Anställningar\n\n\`\`\`markdown\n${employmentLine}\n\`\`\`\n`
    );
  fs.writeFileSync(sourcePath, source);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CV employmentLine publication override must match exactly once in source and exactly once outside code blocks/);
}));

test('rejects a fenced duplicate employment line during source validation before write', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const employmentLine = '- Konsult hos Exempel Konsult AB, 2022 - pågående';
  const originalOutputs = new Map(generatedPages.map(page => [
    page,
    fs.readFileSync(target(root, page), 'utf8')
  ]));
  const source = fs.readFileSync(sourcePath, 'utf8').replace(
    /(^## Anställningar\r?\n)/m,
    `$1\n\`\`\`markdown\n${employmentLine}\n\`\`\`\n`
  );
  fs.writeFileSync(sourcePath, source);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /CV employmentLine publication override must match exactly once in source and exactly once outside code blocks/);

  const writeResult = run(root, '--write');
  assert.notEqual(writeResult.status, 0);
  assert.match(writeResult.stderr, /CV employmentLine publication override must match exactly once in source and exactly once outside code blocks/);
  for (const page of generatedPages) {
    assert.equal(fs.readFileSync(target(root, page), 'utf8'), originalOutputs.get(page), `${page} must remain unchanged`);
  }
  assert.equal(fs.existsSync(target(root, 'content/generated-provenance.json')), false);
  assert.equal(fs.existsSync(target(root, transactionPath)), false);
  assert.equal(fs.existsSync(target(root, generationLockPath)), false);
}));

test('syncs every committed output and parent directory before removing the journal', t => withFixture(t, root => {
  const { preload, trace } = createSyncTraceAdapter(root);
  const result = run(root, '--write', preload);
  assert.equal(result.status, 0, result.stderr);

  const events = fs.readFileSync(trace, 'utf8').trim().split('\n');
  const journalRemoval = events.indexOf(`remove:${transactionPath}`);
  const outputs = [...generatedPages, 'content/generated-provenance.json'];
  assert.ok(journalRemoval >= 0);
  for (const relativePath of outputs) {
    const rename = events.findIndex(event => event.endsWith(`->${relativePath}`));
    const stagedPath = events[rename]?.slice('rename:'.length).split('->')[0];
    const fileSync = events.indexOf(`file-fsync:${stagedPath}`);
    const parent = path.posix.dirname(relativePath) === '.' ? '.' : path.posix.dirname(relativePath);
    const parentSync = events.indexOf(`sync-fsync:${parent}`, rename + 1);
    assert.ok(rename >= 0, `${relativePath} should be atomically replaced`);
    assert.ok(fileSync >= 0 && fileSync < rename && rename < journalRemoval,
      `${relativePath} should be synced before replacement and before journal removal`);
    assert.ok(parentSync > rename && parentSync < journalRemoval,
      `${parent} should be synced after its output and before journal removal`);
  }
  assert.ok(events.indexOf('sync-fsync:.', journalRemoval + 1) > journalRemoval,
    'the repository root should be synced after journal removal');
}));

test('does not roll back committed outputs when syncing journal removal fails', t => withFixture(t, root => {
  const { preload } = createSyncTraceAdapter(root);
  const result = run(root, '--write', preload, { CONTENT_FAIL_POST_JOURNAL_FSYNC: '1' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /outputs are committed.*journal cleanup\/durability is uncertain/i);
  assert.equal(fs.existsSync(target(root, transactionPath)), false);
  assert.equal(run(root, '--check').status, 0);
}));

test('keeps committed outputs when journal removal fails and recovers cleanup without rollback', t => withFixture(t, root => {
  const baseline = generatedPages.map(page => fs.readFileSync(target(root, page)));
  const { preload } = createSyncTraceAdapter(root);
  const failed = run(root, '--write', preload, { CONTENT_FAIL_JOURNAL_REMOVE: '1' });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /outputs are committed.*journal cleanup\/durability is uncertain.*simulated journal removal failure/i);
  const journal = JSON.parse(fs.readFileSync(target(root, transactionPath), 'utf8'));
  assert.equal(journal.committed, true);
  assert.notDeepEqual(generatedPages.map(page => fs.readFileSync(target(root, page))), baseline);
  for (const entry of journal.entries) {
    assert.deepEqual(fs.readFileSync(target(root, entry.path)), Buffer.from(entry.nextContent, 'base64'));
  }

  const retry = run(root, '--write');
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /Recovered committed content-generation transaction journal/);
  assert.equal(fs.existsSync(target(root, transactionPath)), false);
  assert.equal(run(root, '--check').status, 0);
}));

test('refuses concurrent generation while another process owns the filesystem lock', async t => withFixture(t, async root => {
  const holder = await startLockHolder(root);
  t.after(() => stopLockHolder(holder));
  const lockPath = target(root, generationLockPath);
  const originalLock = fs.readFileSync(lockPath, 'utf8');
  for (const mode of ['--check', '--write']) {
    const result = run(root, mode);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /locked by PID .*Confirm no content-generation process is active.*manually remove the exact lock file/);
    assert.equal(fs.readFileSync(lockPath, 'utf8'), originalLock);
  }
}));

test('refuses a lock owned by the current live process', t => withFixture(t, root => {
  const lock = { pid: process.pid, token: randomUUID() };
  fs.writeFileSync(target(root, generationLockPath), `${JSON.stringify(lock)}\n`);
  const result = run(root, '--write');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, new RegExp(`locked by PID ${process.pid}.*manually remove the exact lock file`));
  assert.deepEqual(JSON.parse(fs.readFileSync(target(root, generationLockPath), 'utf8')), lock);
}));

test('leaves an exited process lock untouched until manual cleanup, then recovers the journal', async t => withFixture(t, async root => {
  const { preload } = createSyncTraceAdapter(root);
  const interrupted = run(root, '--write', preload, { CONTENT_FAIL_JOURNAL_REMOVE: '1' });
  assert.notEqual(interrupted.status, 0);
  assert.ok(fs.existsSync(target(root, transactionPath)));

  const holder = await startLockHolder(root);
  const lockPath = target(root, generationLockPath);
  const lockContents = fs.readFileSync(lockPath, 'utf8');
  const lock = JSON.parse(lockContents);
  await stopLockHolder(holder);
  assert.throws(() => process.kill(lock.pid, 0), error => error.code === 'ESRCH');
  assert.equal(fs.readFileSync(lockPath, 'utf8'), lockContents);

  const blocked = run(root, '--write');
  assert.notEqual(blocked.status, 0);
  assert.match(blocked.stderr, new RegExp(`locked by PID ${lock.pid}.*manually remove the exact lock file`));
  assert.equal(fs.readFileSync(lockPath, 'utf8'), lockContents);
  assert.ok(fs.existsSync(target(root, transactionPath)));

  fs.unlinkSync(lockPath);
  const retry = run(root, '--write');
  assert.equal(retry.status, 0, retry.stderr);
  assert.match(retry.stdout, /Recovered committed content-generation transaction journal/);
  assert.equal(fs.existsSync(lockPath), false);
  assert.equal(fs.existsSync(target(root, transactionPath)), false);
}));

test('removes its own lock after successful generation', t => withFixture(t, root => {
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(target(root, generationLockPath)), false);
}));

test('preserves acquisition failure and reports actionable lock cleanup failure', t => withFixture(t, root => {
  const { preload } = createSyncTraceAdapter(root);
  const result = run(root, '--check', preload, {
    CONTENT_FAIL_LOCK_FSYNC: '1',
    CONTENT_FAIL_LOCK_REMOVE: '1'
  });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /simulated lock acquisition failure/);
  assert.match(result.stderr, /lock cleanup also failed: simulated lock removal failure/);
  assert.match(result.stderr, /\.cv-generation\.lock file may remain/);
  assert.match(result.stderr, /inspect that exact file and its PID, confirm no content-generation process is active/);
  assert.match(result.stderr, /Remove-Item -LiteralPath \.cv-generation\.lock/);
  assert.ok(fs.existsSync(target(root, generationLockPath)));
}));

test('preserves generation failure and reports actionable lock release failure', t => withFixture(t, root => {
  injectWriteFault(root, "{ throw new Error('simulated mid-write failure'); }");
  const { preload } = createSyncTraceAdapter(root);
  const result = run(root, '--write', preload, { CONTENT_FAIL_LOCK_REMOVE: '1' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /simulated mid-write failure/);
  assert.match(result.stderr, /lock cleanup also failed: simulated lock removal failure/);
  assert.match(result.stderr, /\.cv-generation\.lock file may remain/);
  assert.match(result.stderr, /inspect that exact file and its PID, confirm no content-generation process is active/);
  assert.match(result.stderr, /Remove-Item -LiteralPath \.cv-generation\.lock/);
  assert.ok(fs.existsSync(target(root, generationLockPath)));
}));

test('reports lock release failure after successful generation without undoing outputs', t => withFixture(t, root => {
  const { preload } = createSyncTraceAdapter(root);
  const result = run(root, '--write', preload, { CONTENT_FAIL_LOCK_RELEASE_SYNC: '1' });

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Content generation completed, but releasing its lock failed/);
  assert.match(result.stderr, /simulated lock release directory sync failure/);
  assert.match(result.stderr, /\.cv-generation\.lock file may remain/);
  assert.match(result.stderr, /inspect that exact file and its PID, confirm no content-generation process is active/);
  assert.match(result.stderr, /Remove-Item -LiteralPath \.cv-generation\.lock/);
  assert.equal(fs.existsSync(target(root, generationLockPath)), false);
  assert.notEqual(fs.readFileSync(target(root, generatedPages[0]), 'utf8'), 'known pre-generator page\n');
}));

test('removes only the reserved journal temp when recovering without a journal', t => withFixture(t, root => {
  const journalTemporary = target(root, `${transactionPath}.tmp`);
  const unrelated = target(root, 'unrelated.tmp');
  fs.writeFileSync(journalTemporary, '{"incomplete":');
  fs.writeFileSync(unrelated, 'must remain untouched');

  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.existsSync(journalTemporary), false);
  assert.equal(fs.readFileSync(unrelated, 'utf8'), 'must remain untouched');
}));

test('fails closed for bootstrap mismatches and manual generated-output edits', t => withFixture(t, root => {
  fs.writeFileSync(target(root, 'content/pages/cv.md'), 'manually changed before bootstrap\n');
  const bootstrapConflict = run(root, '--write');
  assert.notEqual(bootstrapConflict.status, 0);
  assert.match(bootstrapConflict.stderr, /Bootstrap output differs from recorded baseline/);

  fs.writeFileSync(target(root, 'content/pages/cv.md'), 'known pre-generator page\n');
  assert.equal(run(root, '--write').status, 0);
  fs.appendFileSync(target(root, 'content/pages/home.md'), '\nmanual edit\n');

  const checkConflict = run(root, '--check');
  assert.notEqual(checkConflict.status, 0);
  assert.match(checkConflict.stderr, /Generated output is stale or modified/);
  const writeConflict = run(root, '--write');
  assert.notEqual(writeConflict.status, 0);
  assert.match(writeConflict.stderr, /Generated output was manually changed; refusing overwrite/);
}));

test('fails closed when generated provenance is manually edited', t => withFixture(t, root => {
  assert.equal(run(root, '--write').status, 0);
  const manifestPath = target(root, 'content/generated-provenance.json');
  const provenance = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  provenance.sourceSha256 = '0'.repeat(64);
  fs.writeFileSync(manifestPath, `${JSON.stringify(provenance, null, 2)}\n`);

  const result = run(root, '--write');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Generated provenance was modified/);
}));

test('rejects a symlinked generated output without modifying its target', t => withFixture(t, root => {
  const generatedPath = target(root, 'content/pages/cv.md');
  const outsidePath = target(root, 'outside-cv.md');
  fs.writeFileSync(outsidePath, 'must remain untouched\n');
  fs.unlinkSync(generatedPath);
  if (!createSymlinkOrSkip(t, outsidePath, generatedPath, 'file')) return;

  const result = run(root, '--write');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Symlink is not allowed in generated content path/);
  assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'must remain untouched\n');
}));

test('rejects a symlinked generated-output parent directory', t => withFixture(t, root => {
  const projectsPath = target(root, 'content/pages/projects');
  const externalProjectsPath = target(root, 'outside-projects');
  fs.mkdirSync(externalProjectsPath);
  fs.rmSync(projectsPath, { recursive: true });
  if (!createSymlinkOrSkip(
    t,
    externalProjectsPath,
    projectsPath,
    process.platform === 'win32' ? 'junction' : 'dir'
  )) return;

  const result = run(root, '--write');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Symlink is not allowed in generated content path/);
  assert.deepEqual(fs.readdirSync(externalProjectsPath), []);
}));

test('rejects a symlinked transaction journal without modifying its target', t => withFixture(t, root => {
  const journalTarget = target(root, transactionPath);
  const outsidePath = target(root, 'outside-journal.json');
  fs.writeFileSync(outsidePath, 'must remain untouched\n');
  if (!createSymlinkOrSkip(t, outsidePath, journalTarget, 'file')) return;

  const result = run(root, '--write');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Symlink is not allowed in generated content path/);
  assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'must remain untouched\n');
}));

test('rejects a symlinked generation lock without modifying its target', t => withFixture(t, root => {
  const outsidePath = target(root, 'outside-lock');
  fs.writeFileSync(outsidePath, 'must remain untouched\n');
  if (!createSymlinkOrSkip(t, outsidePath, target(root, generationLockPath), 'file')) return;

  const result = run(root, '--write');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Symlink is not allowed in generated content path/);
  assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'must remain untouched\n');
}));

test('rejects a symlinked canonical source', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const outsidePath = target(root, 'outside-source.md');
  fs.writeFileSync(outsidePath, 'must not be read\n');
  fs.unlinkSync(sourcePath);
  if (!createSymlinkOrSkip(t, outsidePath, sourcePath, 'file')) return;

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Symlink is not allowed in generated content path/);
}));

test('rejects a directory site configuration', t => withFixture(t, root => {
  const sitePath = target(root, 'content/site.json');
  fs.rmSync(sitePath);
  fs.mkdirSync(sitePath);

  const result = run(root, '--validate-source', undefined, {}, 5000);
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Repository path is not a regular file: content\/site\.json/);
}));

test('rejects a directory transaction journal', t => withFixture(t, root => {
  const journalPath = target(root, transactionPath);
  fs.mkdirSync(journalPath);

  const result = run(root, '--write', undefined, {}, 5000);
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Repository path is not a regular file: \.content-generation\.transaction\.json/);
  assert.equal(fs.existsSync(target(root, generationLockPath)), false);
}));

test('rejects a FIFO site configuration without blocking', t => withFixture(t, root => {
  const sitePath = target(root, 'content/site.json');
  fs.rmSync(sitePath);
  if (!createFifoOrSkip(t, sitePath)) return;

  const result = run(root, '--validate-source', undefined, {}, 5000);
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Repository path is not a regular file: content\/site\.json/);
}));

test('rejects a FIFO transaction journal without blocking', t => withFixture(t, root => {
  const journalPath = target(root, transactionPath);
  if (!createFifoOrSkip(t, journalPath)) return;

  const result = run(root, '--write', undefined, {}, 5000);
  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Repository path is not a regular file: \.content-generation\.transaction\.json/);
  assert.equal(fs.existsSync(target(root, generationLockPath)), false);
}));

test('rejects a byte-identical regular input replaced after inspection and before open', t => withFixture(t, root => {
  const race = createReadRaceAdapter(root, 'content/site.json', 'replacement', t);
  if (!race) return;
  const result = run(root, '--validate-source', race.preload, race.env, 5000);

  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Repository path changed during generation: content\/site\.json/);
}));

test('does not block when site.json is replaced by a FIFO immediately before open', t => withFixture(t, root => {
  const fifoProbe = target(root, 'scripts/fifo-probe');
  if (!createFifoOrSkip(t, fifoProbe)) return;
  fs.rmSync(fifoProbe);

  const race = createReadRaceAdapter(root, 'content/site.json', 'fifo');
  const result = run(root, '--validate-source', race.preload, race.env, 5000);

  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Repository path is not a regular file: content\/site\.json/);
}));

test('does not block when the transaction journal is replaced by a FIFO before open', t => withFixture(t, root => {
  const fifoProbe = target(root, 'scripts/fifo-probe');
  if (!createFifoOrSkip(t, fifoProbe)) return;
  fs.rmSync(fifoProbe);
  fs.writeFileSync(target(root, transactionPath), 'pending transaction\n');

  const race = createReadRaceAdapter(root, transactionPath, 'fifo');
  const result = run(root, '--write', race.preload, race.env, 5000);

  assert.equal(result.error, undefined, result.error?.message);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr,
    /Cannot read pending content-generation transaction journal: Repository path is not a regular file: \.content-generation\.transaction\.json/);
  assert.equal(fs.existsSync(target(root, generationLockPath)), false);
}));

test('fails closed during recovery when an output has become a symlink', t => withFixture(t, root => {
  assert.equal(run(root, '--write').status, 0);
  const generatorPath = target(root, 'scripts/content/generate-content.mjs');
  const generator = fs.readFileSync(generatorPath, 'utf8');
  injectWriteFault(root, '{ process.exit(86); }');

  const interrupted = run(root, '--write');
  assert.equal(interrupted.status, 86);
  fs.writeFileSync(generatorPath, generator);
  fs.unlinkSync(target(root, generationLockPath));

  const generatedPath = target(root, 'content/pages/home.md');
  const outsidePath = target(root, 'outside-home.md');
  fs.writeFileSync(outsidePath, 'must remain untouched\n');
  fs.unlinkSync(generatedPath);
  if (!createSymlinkOrSkip(t, outsidePath, generatedPath, 'file')) return;

  const recovery = run(root, '--write');
  assert.notEqual(recovery.status, 0);
  assert.match(recovery.stderr, /Symlink is not allowed in generated content path/);
  assert.equal(fs.readFileSync(outsidePath, 'utf8'), 'must remain untouched\n');
  assert.equal(fs.existsSync(target(root, transactionPath)), true);
}));

test('preserves manual edits made while a transaction is pending', t => withFixture(t, root => {
  assert.equal(run(root, '--write').status, 0);
  const generatorPath = target(root, 'scripts/content/generate-content.mjs');
  const generator = fs.readFileSync(generatorPath, 'utf8');
  injectWriteFault(root, '{ process.exit(86); }');

  const interrupted = run(root, '--write');
  assert.equal(interrupted.status, 86);
  fs.writeFileSync(generatorPath, generator);
  fs.unlinkSync(target(root, generationLockPath));

  const manuallyEditedPath = target(root, 'content/pages/home.md');
  fs.appendFileSync(manuallyEditedPath, '\nmanual edit during recovery\n');
  const manualEdit = fs.readFileSync(manuallyEditedPath);
  const recovery = run(root, '--write');
  assert.notEqual(recovery.status, 0);
  assert.match(recovery.stderr, /Generated output was manually changed during an interrupted transaction/);
  assert.deepEqual(fs.readFileSync(manuallyEditedPath), manualEdit);
  assert.equal(fs.existsSync(target(root, transactionPath)), true);
}));

test('rolls back a caught mid-write error and permits a clean retry', t => withFixture(t, root => {
  const initialWrite = run(root, '--write');
  assert.equal(initialWrite.status, 0, initialWrite.stderr);
  const before = [...generatedPages, 'content/generated-provenance.json']
    .map(page => fs.readFileSync(target(root, page)));
  const generatorPath = target(root, 'scripts/content/generate-content.mjs');
  const generator = fs.readFileSync(generatorPath, 'utf8');
  injectWriteFault(root, "{ throw new Error('simulated mid-write failure'); }");

  const failed = run(root, '--write');
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /simulated mid-write failure/);
  assert.equal(fs.existsSync(target(root, transactionPath)), false);
  assert.deepEqual([...generatedPages, 'content/generated-provenance.json']
    .map(page => fs.readFileSync(target(root, page))), before);

  fs.writeFileSync(generatorPath, generator);
  const retry = run(root, '--write');
  assert.equal(retry.status, 0, retry.stderr);
  assert.equal(run(root, '--check').status, 0);
}));

test('recovers an interrupted write on the next run and allows retry without conflict', t => withFixture(t, root => {
  assert.equal(run(root, '--write').status, 0);
  const generatorPath = target(root, 'scripts/content/generate-content.mjs');
  const generator = fs.readFileSync(generatorPath, 'utf8');
  injectWriteFault(root, '{ process.exit(86); }');

  const interrupted = run(root, '--write');
  assert.equal(interrupted.status, 86);
  assert.equal(fs.existsSync(target(root, transactionPath)), true);
  fs.unlinkSync(target(root, generationLockPath));
  const pendingCheck = run(root, '--check');
  assert.notEqual(pendingCheck.status, 0);
  assert.match(pendingCheck.stderr, /Pending content-generation transaction journal found/);

  fs.writeFileSync(generatorPath, generator);
  const recoveredRetry = run(root, '--write');
  assert.equal(recoveredRetry.status, 0, recoveredRetry.stderr);
  assert.match(recoveredRetry.stdout, /Recovered and rolled back pending/);
  assert.equal(fs.existsSync(target(root, transactionPath)), false);
  assert.equal(fs.existsSync(target(root, `${transactionPath}.tmp`)), false);
  assert.equal(run(root, '--check').status, 0);
}));

test('syncs restored and deleted output parents before removing the recovery journal', t => withFixture(t, root => {
  const initialWrite = run(root, '--write');
  assert.equal(initialWrite.status, 0, initialWrite.stderr);

  const outputPaths = [...generatedPages, 'content/generated-provenance.json'];
  const entries = outputPaths.map(relativePath => {
    const nextContent = fs.readFileSync(target(root, relativePath));
    const restoring = relativePath === 'content/pages/home.md';
    const deleting = relativePath === 'content/pages/projects/lanternan.md';
    const previousContent = restoring
      ? Buffer.from('known pre-generator page\n')
      : deleting ? undefined : nextContent;
    const directory = path.posix.dirname(relativePath);
    const basename = path.posix.basename(relativePath);
    const stagedPath = `${directory === '.' ? '' : `${directory}/`}${basename}.content-generation-1-${randomUUID()}.tmp`;
    return {
      path: relativePath,
      existed: !deleting,
      previousContent: previousContent?.toString('base64') ?? null,
      nextContent: nextContent.toString('base64'),
      stagedPath
    };
  });
  fs.writeFileSync(target(root, transactionPath), `${JSON.stringify({ version: 2, entries })}\n`);

  injectExitAfterRecovery(root);
  const { preload, trace } = createSyncTraceAdapter(root);
  const recovery = run(root, '--write', preload);
  assert.equal(recovery.status, 86, recovery.stderr);
  assert.deepEqual(fs.readFileSync(target(root, 'content/pages/home.md')), Buffer.from('known pre-generator page\n'));
  assert.equal(fs.existsSync(target(root, 'content/pages/projects/lanternan.md')), false);

  const events = fs.readFileSync(trace, 'utf8').trim().split('\n');
  const journalRemoval = events.indexOf(`remove:${transactionPath}`);
  const restoreRename = events.indexOf(`rename:${entries[1].stagedPath}->content/pages/home.md`);
  const restoreSync = events.indexOf('sync-open:content/pages', restoreRename + 1);
  const deletion = events.indexOf('remove:content/pages/projects/lanternan.md');
  const deletionSync = events.indexOf('sync-open:content/pages/projects', deletion + 1);
  const journalParentSync = events.indexOf('sync-open:.', journalRemoval + 1);
  const assertSyncAttemptAfter = (mutation, parent, successfulOpen, message) => {
    const open = events.indexOf(`sync-open:${parent}`, mutation + 1);
    if (open >= 0) {
      const fsync = events.indexOf(`sync-fsync:${parent}`, open + 1);
      assert.ok(fsync > open, message);
      return;
    }
    const unsupportedOpen = events.find(event => event.startsWith(`sync-open-error:${parent}:`));
    const errorCode = unsupportedOpen?.split(':').at(-1);
    assert.ok(
      ['EINVAL', 'ENOTSUP', 'EOPNOTSUPP', 'EISDIR'].includes(errorCode) ||
        (process.platform === 'win32' && errorCode === 'EPERM'),
      `${message}; directory sync can be skipped only for an explicitly unsupported platform error`
    );
    assert.ok(successfulOpen < 0, 'unsupported open should not also have succeeded');
  };
  assert.ok(restoreRename >= 0, 'recovery should atomically restore the prior file');
  assert.ok(restoreSync > restoreRename && restoreSync < journalRemoval,
    'the restored file parent must be synced before journal removal');
  assertSyncAttemptAfter(restoreRename, 'content/pages', restoreSync,
    'restoring an output must call fsync on its parent');
  assert.ok(deletion >= 0, 'recovery should remove the newly created target');
  assert.ok(deletionSync > deletion && deletionSync < journalRemoval,
    'the deleted file parent must be synced before journal removal');
  assertSyncAttemptAfter(deletion, 'content/pages/projects', deletionSync,
    'deleting an output must call fsync on its parent');
  assert.ok(journalParentSync > journalRemoval, 'the journal parent must be synced after journal removal');
  assertSyncAttemptAfter(journalRemoval, '.', journalParentSync,
    'removing the journal must call fsync on its parent');
}));

test('removes journal-listed staged files after a crash before rename', t => withFixture(t, root => {
  const initialWrite = run(root, '--write');
  assert.equal(initialWrite.status, 0, initialWrite.stderr);
  const generatorPath = target(root, 'scripts/content/generate-content.mjs');
  const generator = fs.readFileSync(generatorPath, 'utf8');
  injectCrashAfterStage(root);

  const interrupted = run(root, '--write');
  assert.equal(interrupted.status, 86);
  const journal = JSON.parse(fs.readFileSync(target(root, transactionPath), 'utf8'));
  assert.equal(journal.version, 2);
  assert.equal(journal.entries.length, generatedPages.length + 1);
  for (const entry of journal.entries) {
    assert.match(entry.stagedPath, /\.content-generation-\d+-[0-9a-f-]+\.tmp$/);
  }
  assert.ok(stagedTemporaryFiles(root).length > 0, 'crash should leave a staged sibling temp file');

  fs.writeFileSync(generatorPath, generator);
  fs.unlinkSync(target(root, generationLockPath));
  const recovery = run(root, '--write');
  assert.equal(recovery.status, 0, recovery.stderr);
  assert.match(recovery.stdout, /Recovered and rolled back pending/);
  assert.deepEqual(stagedTemporaryFiles(root), []);
}));

test('refuses excluded source-map page paths', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  mapping.generatedPages[0].path = 'content/pages/profile.md';
  fs.writeFileSync(mapPath, `${JSON.stringify(mapping, null, 2)}\n`);
  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Excluded page cannot be generated/);
}));

test('rejects mapped output paths that collide by case or Unicode normalization', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const originalProject = mapping.generatedPages.find(page => page.path === 'content/pages/projects/kompass.md');
  const duplicatePath = 'content/pages/projects/KOMPASS.md';
  mapping.generatedPages.push({ ...originalProject, path: duplicatePath });
  mapping.bootstrapOutputSha256[duplicatePath] = hash('known pre-generator page\n');
  fs.writeFileSync(target(root, duplicatePath), 'known pre-generator page\n');
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');
  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Generated page paths must be unique case-insensitively/i);

  mapping.generatedPages.pop();
  delete mapping.bootstrapOutputSha256[duplicatePath];
  originalProject.path = 'content/pages/projects/demo-é.md';
  mapping.generatedPages.push({ ...originalProject, path: 'content/pages/projects/demo-é.md' });
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');
  const normalizedDuplicate = run(root, '--validate-source');
  assert.notEqual(normalizedDuplicate.status, 0);
  assert.match(normalizedDuplicate.stderr, /Generated page paths must be unique case-insensitively/i);
}));

test('rejects reserved page paths case-insensitively', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const cvPage = mapping.generatedPages.find(page => page.path === 'content/pages/cv.md');
  const originalPath = cvPage.path;
  for (const reservedName of ['PROFILE.MD', 'Contact.md', 'Demo-Profile.md']) {
    cvPage.path = 'content/pages/' + reservedName;
    fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');
    const result = run(root, '--validate-source');
    assert.notEqual(result.status, 0, 'accepted reserved path ' + reservedName);
    assert.match(result.stderr, /Excluded page cannot be generated/i);
  }
  cvPage.path = originalPath;
}));

test('rejects Windows-reserved project page basenames', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const original = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  for (const slug of ['con', 'prn', 'aux', 'nul', 'com1', 'lpt9']) {
    const mapping = structuredClone(original);
    const project = mapping.generatedPages.find(page => page.path === 'content/pages/projects/kompass.md');
    const originalPath = project.path;
    project.path = 'content/pages/projects/' + slug + '.md';
    mapping.bootstrapOutputSha256[project.path] = mapping.bootstrapOutputSha256[originalPath];
    delete mapping.bootstrapOutputSha256[originalPath];
    mapping.generatedPages.find(page => page.path === 'content/pages/projects.md')
      .selectedProjects[0].path = '/projects/' + slug;
    fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');
    const result = run(root, '--validate-source');
    assert.notEqual(result.status, 0, 'accepted Windows-reserved project slug ' + slug);
    assert.match(result.stderr, /reserved Windows device name/i);
  }
}));

test('requires lowercase hyphen-separated project page slugs', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const project = mapping.generatedPages.find(page => page.path === 'content/pages/projects/kompass.md');
  const originalPath = project.path;
  project.path = 'content/pages/projects/Bad--Slug.md';
  mapping.bootstrapOutputSha256[project.path] = mapping.bootstrapOutputSha256[originalPath];
  delete mapping.bootstrapOutputSha256[originalPath];
  mapping.generatedPages.find(page => page.path === 'content/pages/projects.md')
    .selectedProjects[0].path = '/projects/Bad--Slug';
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');
  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Project page path must use a lowercase slug/i);
}));

test('rejects mapped output paths outside content/pages', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  mapping.generatedPages[0].path = 'content/unexpected.md';
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');
  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /must be a Markdown file under content\/pages/i);
}));

test('requires bootstrap hashes to cover exactly the current mapped pages', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  delete mapping.bootstrapOutputSha256['content/pages/home.md'];
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');
  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Bootstrap hashes must cover the exact generated page allowlist/);
}));

test('counts H1 headings nested in Markdown lists', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  fs.appendFileSync(sourcePath, '\n\n- # Extra heading\n');
  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0, 'a list-contained H1 must be counted');
  assert.match(result.stderr, /exactly one Markdown H1/i);
}));

test('rejects unsupported descriptions, project titles, and competence block titles', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const baseline = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const cases = [
    ['content/pages/home.md', 'description', 'Award-winning expert with guaranteed results'],
    ['content/pages/projects.md', 'description', 'Guaranteed project outcomes for every client'],
    ['content/pages/projects/lanternan.md', 'description', 'An unsupported tool for imaginary teams'],
    ['content/pages/projects/lanternan.md', 'title', 'Unsupported invented project title'],
    ['content/pages/services.md', 'competenceBlocks', 'Unsupported AI transformation leadership']
  ];
  for (const [pagePath, field, unsupported] of cases) {
    const mapping = structuredClone(baseline);
    const page = mapping.generatedPages.find(item => item.path === pagePath);
    if (field === 'competenceBlocks') page.competenceBlocks[0].title = unsupported;
    else page[field] = unsupported;
    fs.writeFileSync(mapPath, `${JSON.stringify(mapping, null, 2)}\n`);
    const result = run(root, '--validate-source');
    assert.notEqual(result.status, 0, `accepted unsupported ${pagePath}.${field}`);
    assert.match(result.stderr, /source evidence|match.*source|unsupported.*title/i);
  }
}));

test('does not use fenced or indented code as home hero tagline evidence', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const map = JSON.parse(fs.readFileSync(target(root, 'content/source-map.json'), 'utf8'));
  const home = map.generatedPages.find(page => page.path === 'content/pages/home.md');
  const tagline = home.heroTagline;
  home.description = map.generatedPages.find(page => page.path === 'content/pages/cv.md').description;
  fs.writeFileSync(target(root, 'content/source-map.json'), `${JSON.stringify(map, null, 2)}\n`);
  const original = fs.readFileSync(sourcePath, 'utf8');
  assert.ok(original.includes(tagline));
  for (const codeEvidence of [
    `\`\`\`text\n${tagline}\n\`\`\``,
    `    ${tagline}`,
    `\`${tagline}\``,
    `> \`\`\`text\n> ${tagline}\n> \`\`\``
  ]) {
    const source = original.replace(tagline, '').replace('## Kompetensområden', `${codeEvidence}\n\n## Kompetensområden`);
    fs.writeFileSync(sourcePath, source);
    const result = run(root, '--validate-source');
    assert.notEqual(result.status, 0, 'hero tagline present only in code must fail closed');
    assert.match(result.stderr, /Home hero tagline is missing from source evidence|Page description lacks source evidence: content\/pages\/home\.md/);
  }
}));

test('emits competency source lines as parsed visible prose, never inline-code values', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const mappingPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));
  const block = mapping.generatedPages.find(page => page.path === 'content/pages/services.md').competenceBlocks[0];
  const sourceLine = block.sourceLines[0];
  const injectedLine = sourceLine.replace('Systemdesign', '`secret claim` Systemdesign');
  fs.writeFileSync(sourcePath, fs.readFileSync(sourcePath, 'utf8').replace(sourceLine, injectedLine));
  block.sourceLines = [injectedLine];
  fs.writeFileSync(mappingPath, `${JSON.stringify(mapping, null, 2)}\n`);

  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const services = fs.readFileSync(target(root, 'content/pages/services.md'), 'utf8');
  assert.ok(services.includes(injectedLine.replace('`secret claim` ', '')));
  assert.ok(!services.includes('secret claim'), 'inline-code value must not be emitted as source-backed fact');
}));

function editCvSections(root, change) {
  const configPath = target(root, 'content/cv-sections.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  change(config.sections);
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
}

test('an optional CV section missing from the source is reported as INFO, not as an error', t => withFixture(t, root => {
  editCvSections(root, sections => sections.push({ heading: 'Saknas', required: false, publish: true }));
  const result = run(root, '--validate-source');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^INFO: Optional CV section is not in the source: Saknas$/m);
}));

test('a required CV section missing from the source fails the generation', t => withFixture(t, root => {
  editCvSections(root, sections => sections.push({ heading: 'Saknas', required: true, publish: true }));
  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required source heading not found: ## Saknas/);
}));

test('a section marked publish false is left out of the published CV but kept in the source', t => withFixture(t, root => {
  editCvSections(root, sections => {
    sections.find(section => section.heading === 'Språk').publish = false;
  });
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr);
  const cv = fs.readFileSync(target(root, 'content/pages/cv.md'), 'utf8');
  assert.doesNotMatch(cv, /^## Språk$/m);
  assert.match(cv, /^## Branscherfarenhet$/m);
  assert.match(cv, /^## Uppdragshistorik$/m);
  assert.match(fs.readFileSync(target(root, 'content/sources/master-cv.md'), 'utf8'), /^## Språk$/m);
}));

test('the default configuration publishes every CV section that is in the source', t => withFixture(t, root => {
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr);
  const cv = fs.readFileSync(target(root, 'content/pages/cv.md'), 'utf8');
  for (const heading of ['Roller', 'Översikt', 'Kompetensområden', 'Branscherfarenhet', 'Uppdragshistorik', 'Anställningar']) {
    assert.match(cv, new RegExp(`^## ${heading}$`, 'm'));
  }
}));

test('a required CV section cannot be marked publish false', t => withFixture(t, root => {
  editCvSections(root, sections => {
    sections.find(section => section.heading === 'Roller').publish = false;
  });
  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Required CV section 'Roller' cannot be unpublished/);
}));

test('the CV section configuration rejects duplicate headings and missing flags', t => withFixture(t, root => {
  editCvSections(root, sections => sections.push({ heading: 'Språk', required: false, publish: true }));
  const duplicate = run(root, '--validate-source');
  assert.notEqual(duplicate.status, 0);
  assert.match(duplicate.stderr, /CV section 'Språk' is listed more than once/);

  editCvSections(root, sections => {
    sections.length = 0;
    sections.push({ heading: 'Roller', required: true });
  });
  const missingFlag = run(root, '--validate-source');
  assert.notEqual(missingFlag.status, 0);
  assert.match(missingFlag.stderr, /must set required and publish/);
}));


test('rejects structural heading collisions that make project extraction ambiguous', t => withFixture(t, root => {
  const configPath = target(root, 'content/cv-sections.json');
  const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  config.headings = { projectKeywords: 'Resultat' };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Structural headings 'projectResult' and 'projectKeywords' must be distinct/i);
}));

test('rejects a project section moved outside the configured project history', t => withFixture(t, root => {
  const sourcePath = target(root, 'content/sources/master-cv.md');
  let source = fs.readFileSync(sourcePath, 'utf8');
  const start = source.indexOf('### Projekt Kompass');
  const end = source.indexOf('\n### Projekt Lanternan', start);
  assert.ok(start >= 0 && end > start);
  const projectSection = source.slice(start, end);
  source = source.slice(0, start) + source.slice(end);
  const languageHeading = source.indexOf('## Språk');
  const insertion = source.indexOf('\n', languageHeading) + 1;
  assert.ok(languageHeading >= 0 && insertion > languageHeading);
  source = source.slice(0, insertion) + '\n' + projectSection + '\n' + source.slice(insertion);
  fs.writeFileSync(sourcePath, source);

  const result = run(root, '--validate-source');
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Project heading 'Projekt Kompass' must be under configured section 'Uppdragshistorik'/i);
}));

test('supports adding a mapped project after initial generation', t => withFixture(t, root => {
  const initial = run(root, '--write');
  assert.equal(initial.status, 0, initial.stderr || initial.stdout);
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const pagePath = 'content/pages/projects/stjarna.md';
  const baseline = 'known pre-generator page\n';
  const sourcePath = target(root, 'content/sources/master-cv.md');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const historyEnd = source.indexOf('\n## Anställningar');
  assert.ok(historyEnd > 0);
  const projectSection = [
    '### Projekt Stjärna', '**Period:** 2021 - 2022', '**Roll:** Tjänsteutvecklare', '',
    'Stjärna ger föreningar en enkel plats att samla information.',
    '- Byggde en sökbar översikt för medlemmar.', '', '#### Resultat',
    'Medlemmar hittade aktuell information snabbare.', '', '#### Nyckelord', 'Node.js, SQLite'
  ].join('\n');
  fs.writeFileSync(sourcePath, source.slice(0, historyEnd) + '\n\n' + projectSection + source.slice(historyEnd));
  const summary = 'Medlemmar hittade aktuell information snabbare.';
  mapping.generatedPages.find(page => page.path === 'content/pages/projects.md').selectedProjects.push({
    section: 'Projekt Stjärna', path: '/projects/stjarna', summary
  });
  mapping.generatedPages.push({
    path: pagePath, type: 'project', title: 'Projekt Stjärna', description: summary,
    locale: 'sv-SE', status: 'published', summary,
    sourceSection: 'Uppdragshistorik / Projekt Stjärna', sourceHeading: 'Projekt Stjärna'
  });
  mapping.bootstrapOutputSha256[pagePath] = hash(baseline);
  fs.writeFileSync(target(root, pagePath), baseline);
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');

  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const provenance = JSON.parse(fs.readFileSync(target(root, 'content/generated-provenance.json'), 'utf8'));
  assert.ok(provenance.generatedPages.includes(pagePath));
  assert.match(fs.readFileSync(target(root, pagePath), 'utf8'), /Projekt Stjärna/);
}));

test('uses the exact mapping override as the only CV publication source', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  const cvPage = mapping.generatedPages.find(page => page.path === 'content/pages/cv.md');
  cvPage.approvedCvPublicationText.employmentLine.published = '- Oberoende rådgivare, 2022 - pågående';
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(fs.readFileSync(target(root, 'content/pages/cv.md'), 'utf8'), /Oberoende rådgivare/);
}));

test('omits the optional CV publication override when the mapping leaves it out', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  delete mapping.generatedPages.find(page => page.path === 'content/pages/cv.md').approvedCvPublicationText;
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const cv = fs.readFileSync(target(root, 'content/pages/cv.md'), 'utf8');
  assert.match(cv, /Konsult hos Exempel Konsult AB/);
  assert.doesNotMatch(cv, /Oberoende konsult/);
}));

test('omits links when a mapped project does not define them', t => withFixture(t, root => {
  const mapPath = target(root, 'content/source-map.json');
  const mapping = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
  delete mapping.generatedPages.find(page => page.path === 'content/pages/projects/lanternan.md').links;
  fs.writeFileSync(mapPath, JSON.stringify(mapping, null, 2) + '\n');
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const frontmatter = fs.readFileSync(target(root, 'content/pages/projects/lanternan.md'), 'utf8').split('---')[1];
  assert.doesNotMatch(frontmatter, /^links:/m);
}));

test('supports configurable structural headings and rejects unknown heading keys', t => withFixture(t, root => {
  const sectionsPath = target(root, 'content/cv-sections.json');
  const config = JSON.parse(fs.readFileSync(sectionsPath, 'utf8'));
  config.headings = {
    projectSummary: 'Uppdrag i korthet',
    projectResponsibilities: 'Genomfört arbete',
    projectResult: 'Effekt',
    projectKeywords: 'Teknikord',
    projectTechnology: 'Teknikområden'
  };
  fs.writeFileSync(sectionsPath, JSON.stringify(config, null, 2) + '\n');
  const sourcePath = target(root, 'content/sources/master-cv.md');
  fs.writeFileSync(sourcePath, fs.readFileSync(sourcePath, 'utf8')
    .replaceAll('#### Resultat', '#### Effekt')
    .replaceAll('#### Nyckelord', '#### Teknikord'));
  const result = run(root, '--write');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const project = fs.readFileSync(target(root, 'content/pages/projects/kompass.md'), 'utf8');
  for (const heading of ['Uppdrag i korthet', 'Genomfört arbete', 'Effekt', 'Teknikområden']) {
    assert.match(project, new RegExp('^## ' + heading + '$', 'm'));
  }
  config.headings.unrecognizedHeading = 'Okänd';
  fs.writeFileSync(sectionsPath, JSON.stringify(config, null, 2) + '\n');
  const unknown = run(root, '--validate-source');
  assert.notEqual(unknown.status, 0);
  assert.match(unknown.stderr, /unknown heading/i);
  for (const invalidValue of [null, 42, '', 'Two\nlines']) {
    config.headings = { projectResult: invalidValue };
    fs.writeFileSync(sectionsPath, JSON.stringify(config, null, 2) + '\n');
    const invalid = run(root, '--validate-source');
    assert.notEqual(invalid.status, 0, `accepted invalid heading value ${JSON.stringify(invalidValue)}`);
    assert.match(invalid.stderr, /headings must be an object|non-empty single-line string/i);
  }
}));

test('accepts an external data root and hashes the running generator', t => withFixture(t, root => {
  const result = spawnSync(process.execPath, [
    path.join(repositoryRoot, 'scripts', 'content', 'generate-content.mjs'), '--write', '--root', root
  ], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const provenance = JSON.parse(fs.readFileSync(target(root, 'content/generated-provenance.json'), 'utf8'));
  assert.equal(provenance.generator, 'scripts/content/generate-content.mjs');
  assert.equal(
    provenance.generatorSha256,
    hash(normalize(fs.readFileSync(path.join(repositoryRoot, 'scripts/content/generate-content.mjs'), 'utf8')))
  );
}));

test('records and checks the verified app commit SHA', t => withFixture(t, root => {
  const git = spawnSync('git', [
    '-C', repositoryRoot, 'rev-list', '--max-count=2', 'HEAD'
  ], { encoding: 'utf8' });
  assert.equal(git.status, 0, git.stderr || git.stdout);
  const [appCommitSha, otherCommitSha] = git.stdout.trim().split(/\r?\n/u);
  assert.match(appCommitSha, /^[a-f0-9]{40}$/u);

  const generatorPath = path.join(repositoryRoot, 'scripts', 'content', 'generate-content.mjs');
  const malformedPin = spawnSync(process.execPath, [
    generatorPath, '--validate-source', '--root', root, '--app-commit-sha', 'not-a-commit-sha'
  ], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.notEqual(malformedPin.status, 0);
  assert.match(malformedPin.stderr, /full 40-character lowercase Git commit SHA/i);

  const write = spawnSync(process.execPath, [
    generatorPath, '--write', '--root', root, '--app-commit-sha', appCommitSha
  ], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(write.status, 0, write.stderr || write.stdout);

  const provenancePath = target(root, 'content/generated-provenance.json');
  const provenance = JSON.parse(fs.readFileSync(provenancePath, 'utf8'));
  assert.equal(provenance.appCommitSha, appCommitSha);
  assert.equal(
    provenance.generatorSha256,
    hash(normalize(fs.readFileSync(generatorPath, 'utf8')))
  );

  const check = spawnSync(process.execPath, [
    generatorPath, '--check', '--root', root, '--app-commit-sha', appCommitSha
  ], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.equal(check.status, 0, check.stderr || check.stdout);

  const missingPin = spawnSync(process.execPath, [
    generatorPath, '--check', '--root', root
  ], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.notEqual(missingPin.status, 0);
  assert.match(missingPin.stderr, /app commit SHA/i);

  if (!otherCommitSha) {
    t.diagnostic('A second verified Git commit is unavailable; mismatch tampering checks are skipped.');
    return;
  }
  assert.match(otherCommitSha, /^[a-f0-9]{40}$/u);
  const rejectedPin = spawnSync(process.execPath, [
    generatorPath, '--validate-source', '--root', root, '--app-commit-sha', otherCommitSha
  ], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.notEqual(rejectedPin.status, 0);
  assert.match(rejectedPin.stderr, /does not match.*app.*HEAD/i);

  provenance.appCommitSha = otherCommitSha;
  const { provenanceSha256, ...unsigned } = provenance;
  provenance.provenanceSha256 = hash(JSON.stringify(unsigned));
  fs.writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`);

  const mismatch = spawnSync(process.execPath, [
    generatorPath, '--check', '--root', root, '--app-commit-sha', appCommitSha
  ], { cwd: repositoryRoot, encoding: 'utf8' });
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /provenance.*app commit SHA.*match/i);
}));
