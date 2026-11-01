import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const tag = process.argv[2];
if (!tag) throw new Error('Usage: node scripts/write-release-notes.mjs <tag>');

const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const tags = git(['tag', '--sort=-version:refname']).split(/\r?\n/).filter(Boolean);
const currentTagIndex = tags.indexOf(tag);
const previousTag = currentTagIndex >= 0 ? tags[currentTagIndex + 1] : undefined;
const range = previousTag ? `${previousTag}..${tag}` : tag;
const changes = git(['log', '--format=- %s (%h)', range]).split(/\r?\n/).filter(Boolean);
const metadataPath = path.join(root, 'src', 'Portfolio.Web', 'wwwroot', 'build-metadata.json');
const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
const notes = `# ${tag}

## Changes

${changes.length ? changes.join('\n') : '- No commits found for this tag range.'}

## Content changes and migration

- Bundled template content tree: \`${metadata.contentRevision}\`. Real content is delivered separately as a content release from the private content repository.
- Content releases are activated at runtime and do not change with this app release. No content migration is configured; document any required migration before production promotion.

## Rollback

- Previous release: ${previousTag ? `\`${previousTag}\`` : 'none recorded'}.
- Redeploy the previous versioned package and verify \`/health\` using [the rollback runbook](https://github.com/fredrik-hellmangroup/cv-online-presenter/blob/main/docs/rollback-runbook.md).

## Build provenance

- App revision: \`${metadata.appRevision}\`.
- Content revision: \`${metadata.contentRevision}\`.
- Build ID: \`${metadata.buildId}\`.
`;

fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, 'artifacts', 'release-notes.md'), notes, 'utf8');
console.log(`Wrote release notes for ${tag}.`);
