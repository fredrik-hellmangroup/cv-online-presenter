import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'src');
const allowed = new Map([
  ['Portfolio.Contracts', []],
  ['Portfolio.Content', ['Portfolio.Contracts']],
  ['Portfolio.Experience', ['Portfolio.Contracts', 'Portfolio.Content']],
  ['Portfolio.Publishing', ['Portfolio.Contracts', 'Portfolio.Content']],
  ['Portfolio.Infrastructure', ['Portfolio.Contracts']],
  ['Portfolio.Web', ['Portfolio.Contracts', 'Portfolio.Content', 'Portfolio.Experience', 'Portfolio.Publishing', 'Portfolio.Infrastructure']],
]);
const dependencies = new Map();
const errors = [];

for (const [module, permitted] of allowed) {
  const project = readFileSync(join(root, module, `${module}.csproj`), 'utf8');
  const references = [...project.matchAll(/<ProjectReference\s+Include="([^"]+)"/g)]
    .map(match => match[1].replaceAll('\\', '/').split('/').at(-2));
  dependencies.set(module, references);
  for (const reference of references) {
    if (!permitted.includes(reference)) errors.push(`${module} cannot depend on ${reference}`);
  }
  if (readdirSync(join(root, module)).some(file => /^Class1\.cs$/i.test(file)))
    errors.push(`${module} still contains a Class1 placeholder`);
}

const visiting = new Set();
const visited = new Set();
function visit(module) {
  if (visiting.has(module)) {
    errors.push(`dependency cycle through ${module}`);
    return;
  }
  if (visited.has(module)) return;
  visiting.add(module);
  for (const dependency of dependencies.get(module) ?? []) visit(dependency);
  visiting.delete(module);
  visited.add(module);
}
for (const module of allowed.keys()) visit(module);

if (errors.length) {
  for (const error of errors) console.error(error);
  process.exitCode = 1;
} else {
  console.log('Module dependency boundaries are valid.');
}
