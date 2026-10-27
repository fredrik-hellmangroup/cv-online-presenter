import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'client', 'wwwroot', 'js', 'index.js');
const destination = path.join(root, 'src', 'Portfolio.Web', 'wwwroot', 'js', 'index.js');
if (!fs.existsSync(source)) throw new Error('Client bundle is missing; run the TypeScript build first.');
fs.mkdirSync(path.dirname(destination), { recursive: true });
fs.copyFileSync(source, destination);
console.log('Copied the client bundle to the web host static assets.');
