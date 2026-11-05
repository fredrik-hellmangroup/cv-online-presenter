import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { fileURLToPath } from 'node:url';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readJson = relative => JSON.parse(fs.readFileSync(path.join(repositoryRoot, ...relative.split('/')), 'utf8'));
const ajv = new Ajv2020({ allErrors: true, strict: true });
const sourceMapSchema = readJson('content/schema/source-map.schema.json');
const cvSectionsSchema = readJson('content/schema/cv-sections.schema.json');
const validateSourceMap = ajv.compile(sourceMapSchema);
const validateCvSections = ajv.compile(cvSectionsSchema);

test('validates the app template and synthetic fixture against draft 2020-12 schemas', () => {
  const cases = [
    ['app template source map', 'content/source-map.json', validateSourceMap],
    ['app template CV sections', 'content/cv-sections.json', validateCvSections],
    ['synthetic fixture source map', 'scripts/content/fixtures/synthetic/content/source-map.json', validateSourceMap],
    ['synthetic fixture CV sections', 'scripts/content/fixtures/synthetic/content/cv-sections.json', validateCvSections]
  ];
  for (const [label, relativePath, validate] of cases) {
    const value = readJson(relativePath);
    assert.equal(validate(value), true, `${label}: ${ajv.errorsText(validate.errors)}`);
  }
});


test('rejects noncanonical, reserved, and malformed project routes in schemas', () => {
  const base = readJson('scripts/content/fixtures/synthetic/content/source-map.json');
  for (const slug of ['Bad', 'bad--slug', 'con', 'aux', 'com1', 'lpt9']) {
    const mapping = structuredClone(base);
    const project = mapping.generatedPages.find(page => page.path === 'content/pages/projects/kompass.md');
    const originalPath = project.path;
    project.path = 'content/pages/projects/' + slug + '.md';
    mapping.bootstrapOutputSha256[project.path] = mapping.bootstrapOutputSha256[originalPath];
    delete mapping.bootstrapOutputSha256[originalPath];
    mapping.generatedPages.find(page => page.path === 'content/pages/projects.md')
      .selectedProjects[0].path = '/projects/' + slug;
    assert.equal(validateSourceMap(mapping), false, 'accepted project slug ' + slug);
  }

  const malformedRoute = structuredClone(base);
  malformedRoute.generatedPages.find(page => page.path === 'content/pages/projects.md')
    .selectedProjects[0].path = '/projects/bad--slug';
  assert.equal(validateSourceMap(malformedRoute), false, 'accepted malformed selected-project route');
});

test('rejects noncanonical bootstrap hash paths in schemas', () => {
  const base = readJson('scripts/content/fixtures/synthetic/content/source-map.json');
  for (const invalidPath of ['content/pages/../outside.md', 'content/pages/home.md\n']) {
    const mapping = structuredClone(base);
    mapping.bootstrapOutputSha256[invalidPath] = '0'.repeat(64);
    assert.equal(validateSourceMap(mapping), false, 'accepted bootstrap path ' + JSON.stringify(invalidPath));
  }
});
