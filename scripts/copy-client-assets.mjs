import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const source = path.join(root, 'client', 'wwwroot', 'js');
const destination = path.join(root, 'src', 'Portfolio.Web', 'wwwroot', 'js');
if (!fs.existsSync(source)) throw new Error('Client bundle is missing; run the TypeScript build first.');
fs.mkdirSync(destination, { recursive: true });
fs.cpSync(source, destination, { recursive: true });
console.log('Copied the client bundle to the web host static assets.');
