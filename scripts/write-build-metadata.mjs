import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const revision = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
const appRevision = revision(['rev-parse', 'HEAD']);
const contentRevision = revision(['rev-parse', 'HEAD'], path.join(root, 'content'));
const metadata = {
  appRevision,
  contentRevision,
  buildId: process.env.GITHUB_RUN_ID ?? 'local'
};
const outputPath = path.join(root, 'src', 'Portfolio.Web', 'wwwroot', 'build-metadata.json');
fs.writeFileSync(outputPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
console.log(`Wrote build metadata for app ${appRevision} and content ${contentRevision}.`);
