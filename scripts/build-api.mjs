// Build reviewed server code only. Never read environment files, credentials or saves.
import { build } from 'esbuild';
import { readFileSync, readdirSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
const output = resolve('.account-build');
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
const result = await build({
  entryPoints: { main: 'server/main.ts', backup: 'server/backup-cli.ts' },
  outdir: output,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node22',
  format: 'cjs',
  sourcemap: false,
  metafile: true,
  legalComments: 'eof',
  logLevel: 'silent',
});
if (result.warnings.length)
  throw new Error('API bundle emitted warnings; review before packaging.');
const packages = new Map();
for (const input of Object.keys(result.metafile.inputs).sort()) {
  if (!input.includes('node_modules/')) continue;
  let directory = dirname(resolve(input));
  while (directory !== dirname(directory) && !existsSync(join(directory, 'package.json')))
    directory = dirname(directory);
  if (!directory.includes('node_modules'))
    throw new Error('Could not identify a bundled dependency.');
  const pkg = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  const files = readdirSync(directory)
    .filter((name) => /^(?:licen[cs]e|copying|notice)(?:[.-].*)?$/i.test(name))
    .sort();
  if (
    !files.length &&
    existsSync(join(directory, 'README.md')) &&
    /Permission is hereby granted/.test(readFileSync(join(directory, 'README.md'), 'utf8'))
  )
    files.push('README.md');
  if (!files.length) throw new Error('Bundled dependency needs license review: ' + pkg.name);
  packages.set(
    pkg.name + '@' + pkg.version,
    files.map((name) => readFileSync(join(directory, name), 'utf8')).join('\n'),
  );
}
const notices = [...packages]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, license]) => name + '\n' + '='.repeat(name.length) + '\n' + license)
  .join('\n\n');
writeFileSync(join(output, 'THIRD_PARTY_NOTICES.txt'), notices + '\n');
console.log(
  'Built two standalone Node 22 API bundles with dependency notices; no source maps or credentials.',
);
