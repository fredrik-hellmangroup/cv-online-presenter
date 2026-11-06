import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const contentTemplate = path.join(appRoot, 'content');
const generatorPath = path.join(appRoot, 'scripts', 'content', 'generate-content.mjs');
const validatorPath = path.join(appRoot, 'scripts', 'content', 'validate-content.mjs');
const target = (root, relativePath) => path.join(root, ...relativePath.split('/'));

function run(scriptPath, args, cwd = appRoot) {
  return spawnSync(process.execPath, [scriptPath, ...args], { cwd, encoding: 'utf8' });
}

test('fresh synthetic content generates, checks, and validates in an external data checkout', t => {
  const temporaryParent = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-public-content-template-'));
  const externalRoot = path.join(temporaryParent, 'checkout');
  fs.mkdirSync(externalRoot);
  fs.cpSync(contentTemplate, target(externalRoot, 'content'), { recursive: true });

  try {
    const relativeToApp = path.relative(appRoot, externalRoot);
    assert.ok(
      path.isAbsolute(relativeToApp) || relativeToApp === '..' || relativeToApp.startsWith(`..${path.sep}`),
      'the copied data checkout must be outside the app root'
    );

    const mapping = JSON.parse(fs.readFileSync(target(externalRoot, 'content/source-map.json'), 'utf8'));
    const generatedProject = mapping.generatedPages.find(page =>
      page.path === 'content/pages/projects/demo-platform.md');
    assert.ok(generatedProject, 'the published demo-platform route must remain in the template');
    assert.ok(fs.existsSync(target(externalRoot, 'content/pages/contact.md')));
    assert.ok(fs.existsSync(target(externalRoot, 'content/pages/demo-profile.md')));

    const preservedPages = ['content/pages/contact.md', 'content/pages/demo-profile.md'];
    const preservedContent = new Map(preservedPages.map(page => [
      page,
      fs.readFileSync(target(externalRoot, page), 'utf8')
    ]));
    const appContentBefore = fs.readFileSync(target(appRoot, 'content/pages/projects/demo-platform.md'), 'utf8');
    const appProvenancePath = target(appRoot, 'content/generated-provenance.json');
    const appProvenanceBefore = fs.existsSync(appProvenancePath)
      ? fs.readFileSync(appProvenancePath, 'utf8')
      : undefined;

    fs.rmSync(target(externalRoot, 'content/generated-provenance.json'), { force: true });
    const sourcePath = target(externalRoot, 'content/sources/master-cv.md');
    const source = fs.readFileSync(sourcePath, 'utf8');
    fs.writeFileSync(
      sourcePath,
      source.replace(
        'En tydligt märkt syntetisk portfolio',
        'External checkout marker. En tydligt märkt syntetisk portfolio'
      )
    );

    const generated = run(generatorPath, ['--write', '--root', externalRoot]);
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);

    const checked = run(generatorPath, ['--check', '--root', externalRoot]);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);

    const validated = run(validatorPath, ['--root', externalRoot]);
    assert.equal(validated.status, 0, validated.stderr || validated.stdout);

    const projectPath = target(externalRoot, generatedProject.path);
    const project = fs.readFileSync(projectPath, 'utf8');
    const frontMatter = project.split('---')[1];
    assert.match(
      fs.readFileSync(target(externalRoot, 'content/pages/cv.md'), 'utf8'),
      /External checkout marker/u
    );
    assert.doesNotMatch(frontMatter, /^links:/mu);
    for (const page of mapping.generatedPages.filter(candidate => candidate.type === 'project')) {
      const generatedPage = fs.readFileSync(target(externalRoot, page.path), 'utf8');
      assert.doesNotMatch(
        generatedPage.split('---')[1],
        /^links:/mu,
        `${page.path} must not require a links field`
      );
    }

    const provenance = JSON.parse(fs.readFileSync(
      target(externalRoot, 'content/generated-provenance.json'),
      'utf8'
    ));
    assert.equal(provenance.generator, 'scripts/content/generate-content.mjs');
    assert.equal(provenance.appCommitSha, undefined, 'fork template generation does not require a private app pin');
    assert.equal(provenance.generatorSha256.length, 64);
    assert.deepEqual(provenance.generatedPages, mapping.generatedPages.map(page => page.path));
    for (const [page, contents] of preservedContent) {
      assert.equal(fs.readFileSync(target(externalRoot, page), 'utf8'), contents);
    }

    assert.equal(
      fs.readFileSync(target(appRoot, 'content/pages/projects/demo-platform.md'), 'utf8'),
      appContentBefore,
      'generation must not write into the app content tree'
    );
    assert.equal(
      fs.existsSync(appProvenancePath) ? fs.readFileSync(appProvenancePath, 'utf8') : undefined,
      appProvenanceBefore,
      'external generation must not write provenance into the app content tree'
    );
    for (const journal of ['.content-generation.transaction.json', '.cv-generation.lock']) {
      assert.equal(fs.existsSync(target(externalRoot, journal)), false, `${journal} should be cleaned up`);
      assert.equal(fs.existsSync(target(appRoot, journal)), false, `${journal} must not be written in the app root`);
    }
  } finally {
    fs.rmSync(temporaryParent, { recursive: true, force: true });
  }
});

test('checked-in synthetic fixture supports its first write without provenance', t => {
  const temporaryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-synthetic-fixture-first-write-'));
  const fixtureContent = path.join(appRoot, 'scripts', 'content', 'fixtures', 'synthetic', 'content');
  fs.cpSync(fixtureContent, target(temporaryRoot, 'content'), { recursive: true });

  try {
    const provenancePath = target(temporaryRoot, 'content/generated-provenance.json');
    fs.rmSync(provenancePath, { force: true });
    assert.equal(fs.existsSync(provenancePath), false);

    const generated = run(generatorPath, ['--write', '--root', temporaryRoot]);
    assert.equal(generated.status, 0, generated.stderr || generated.stdout);

    const checked = run(generatorPath, ['--check', '--root', temporaryRoot]);
    assert.equal(checked.status, 0, checked.stderr || checked.stdout);

    const validated = run(validatorPath, ['--root', temporaryRoot]);
    assert.equal(validated.status, 0, validated.stderr || validated.stdout);
    assert.equal(fs.existsSync(provenancePath), true);
  } finally {
    fs.rmSync(temporaryRoot, { recursive: true, force: true });
  }
});
