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
    ['synthetic fixture CV sections', 'scripts/content/fixtures/synthetic/content/cv-sections.json', validateCvSections],
    ['synthetic presentation source map', 'scripts/content/fixtures/synthetic-presentation/content/source-map.json', validateSourceMap],
    ['synthetic presentation CV sections', 'scripts/content/fixtures/synthetic-presentation/content/cv-sections.json', validateCvSections]
  ];
  for (const [label, relativePath, validate] of cases) {
    const value = readJson(relativePath);
    assert.equal(validate(value), true, `${label}: ${ajv.errorsText(validate.errors)}`);
  }
});


test('accepts an optional private techReview list and rejects duplicates or unknown fields', () => {
  const base = readJson('scripts/content/fixtures/synthetic/content/source-map.json');
  assert.equal(validateSourceMap({ ...base, techReview: { ignored: ['SOLID', 'Perl'] } }), true);
  assert.equal(validateSourceMap({ ...base, techReview: { ignored: ['SOLID', 'SOLID'] } }), false);
  assert.equal(validateSourceMap({ ...base, techReview: { ignored: [], extra: true } }), false);
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

test('validates opt-in project presentation order and factual fields', () => {
  const base = readJson('scripts/content/fixtures/synthetic/content/source-map.json');
  const projectFor = mapping => mapping.generatedPages.find(page => page.path === 'content/pages/projects/kompass.md');
  const valid = structuredClone(base);
  projectFor(valid).presentation = { order: 2147483646, facts: ['period', 'role', 'industry'] };
  assert.equal(validateSourceMap(valid), true, ajv.errorsText(validateSourceMap.errors));

  const invalidCases = [
    ['non-integer order', mapping => { projectFor(mapping).presentation = { order: 'first' }; }],
    ['reserved unordered sentinel', mapping => { projectFor(mapping).presentation = { order: 2147483647 }; }],
    ['order beyond the app metadata range', mapping => { projectFor(mapping).presentation = { order: 2147483648 }; }],
    ['duplicate facts', mapping => { projectFor(mapping).presentation = { facts: ['period', 'period'] }; }],
    ['unknown fact', mapping => { projectFor(mapping).presentation = { facts: ['customer'] }; }],
    ['empty facts', mapping => { projectFor(mapping).presentation = { facts: [] }; }],
    ['presentation on a non-project page', mapping => {
      mapping.generatedPages.find(page => page.path === 'content/pages/services.md').presentation = { order: 1 };
    }]
  ];

  for (const [label, makeInvalid] of invalidCases) {
    const invalid = structuredClone(base);
    makeInvalid(invalid);
    assert.equal(validateSourceMap(invalid), false, `accepted ${label}`);
  }
});


test('validates grouped service mappings and optional hero metadata in the source-map schema', () => {
  const grouped = structuredClone(readJson('scripts/content/fixtures/synthetic/content/source-map.json'));
  const services = grouped.generatedPages.find(page => page.path === 'content/pages/services.md');
  delete services.competenceBlocks;
  services.competenceGroups = [{
    title: 'Bygga',
    sourceLines: ['Arkitektur, backend och integration.'],
    items: [{
      title: 'Lösningsarkitektur',
      sourceLines: ['Teknisk riktning nära implementation.']
    }]
  }];
  services.kicker = 'Kompetens · syntetisk demo';
  services.panelEyebrow = 'Fyra delar i samma helhet';
  services.panelTitle = 'Kompetens med sammanhang.';
  assert.equal(validateSourceMap(grouped), true, ajv.errorsText(validateSourceMap.errors));

  const missingItemEvidence = structuredClone(grouped);
  delete missingItemEvidence.generatedPages.find(page => page.path === 'content/pages/services.md')
    .competenceGroups[0].items[0].sourceLines;
  assert.equal(validateSourceMap(missingItemEvidence), false, 'accepted an item without source lines');

  const multilineHero = structuredClone(grouped);
  multilineHero.generatedPages.find(page => page.path === 'content/pages/services.md')
    .panelTitle = 'Two\nlines';
  assert.equal(validateSourceMap(multilineHero), false, 'accepted multiline service hero metadata');

  const mixedServiceMappings = structuredClone(grouped);
  mixedServiceMappings.generatedPages.find(page => page.path === 'content/pages/services.md')
    .competenceBlocks = [{ title: 'Legacy', sourceLines: ['- legacy'] }];
  assert.equal(validateSourceMap(mixedServiceMappings), false, 'accepted flat and grouped mappings together');
});

test('rejects whitespace-only grouped evidence and optional service hero metadata', () => {
  const grouped = structuredClone(readJson('scripts/content/fixtures/synthetic/content/source-map.json'));
  const services = grouped.generatedPages.find(page => page.path === 'content/pages/services.md');
  delete services.competenceBlocks;
  services.competenceGroups = [{
    title: 'Bygga',
    sourceLines: ['Arkitektur, backend och integration.'],
    items: [{
      title: 'Lösningsarkitektur',
      sourceLines: ['Teknisk riktning nära implementation.']
    }]
  }];
  services.kicker = 'Kompetens · syntetisk demo';
  services.panelEyebrow = 'Fyra delar i samma helhet';
  services.panelTitle = 'Kompetens med sammanhang.';
  assert.equal(validateSourceMap(grouped), true, ajv.errorsText(validateSourceMap.errors));

  const servicesFor = mapping => mapping.generatedPages.find(page => page.path === 'content/pages/services.md');
  const cases = [
    ['group title', mapping => { servicesFor(mapping).competenceGroups[0].title = '   '; }],
    ['group source line', mapping => { servicesFor(mapping).competenceGroups[0].sourceLines[0] = '\t'; }],
    ['item title', mapping => { servicesFor(mapping).competenceGroups[0].items[0].title = ' \t '; }],
    ['item source line', mapping => { servicesFor(mapping).competenceGroups[0].items[0].sourceLines[0] = '  '; }],
    ['service kicker', mapping => { servicesFor(mapping).kicker = ' \t '; }],
    ['service panel eyebrow', mapping => { servicesFor(mapping).panelEyebrow = '   '; }],
    ['service panel title', mapping => { servicesFor(mapping).panelTitle = '\t'; }]
  ];

  for (const [label, makeInvalid] of cases) {
    const invalid = structuredClone(grouped);
    makeInvalid(invalid);
    assert.equal(validateSourceMap(invalid), false, `accepted whitespace-only ${label}`);
  }
});
