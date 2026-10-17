// A checked, deterministic archive. The trusted host independently validates it.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { cpSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
if (!/^[a-f0-9]{40}$/.test(sha) || process.env.GITHUB_SHA !== sha || process.env.GITHUB_REF !== 'refs/heads/main') {
  throw new Error('Release packaging requires the exact checked main commit in GitHub Actions.');
}
if (execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) {
  throw new Error('Tracked source changed during checks.');
}
const work = mkdtempSync(join(tmpdir(), 'last-spire-release-'));
try {
  cpSync('dist', join(work, 'dist'), { recursive: true, dereference: false });
  const release = { schema: 1, repository: 'YMaximum/last-spire', commit: sha, runId: Number(process.env.GITHUB_RUN_ID) };
  if (!Number.isSafeInteger(release.runId) || release.runId <= 0) throw new Error('Missing workflow run ID.');
  writeFileSync(join(work, 'dist/release.json'), `${JSON.stringify(release)}\n`);
  const files = {};
  const scan = (relative) => {
    for (const name of readdirSync(join(work, relative)).sort()) {
      const path = `${relative}/${name}`;
      const stat = lstatSync(join(work, path));
      if (stat.isDirectory()) scan(path);
      else if (stat.isFile()) {
        if (!/^[a-zA-Z0-9_./-]+$/.test(path)) throw new Error(`Unsupported release path: ${path}`);
        const bytes = readFileSync(join(work, path));
        files[path] = { sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length };
      } else throw new Error(`Release contains a link or special file: ${path}`);
    }
  };
  scan('dist');
  if (!files['dist/index.html'] || Object.keys(files).some((path) => /(?:^|\/)qa[^/]*\.html$/.test(path))) {
    throw new Error('Missing game entrypoint or QA pages included in production.');
  }
  writeFileSync(join(work, 'manifest.json'), `${JSON.stringify({ ...release, files }, null, 2)}\n`);
  mkdirSync('.release', { recursive: true });
  const archive = `last-spire-${sha}.tar.gz`;
  execFileSync('tar', ['--sort=name', '--mtime=@0', '--owner=0', '--group=0', '--numeric-owner', '-czf', `${process.cwd()}/.release/${archive}`, '-C', work, 'manifest.json', 'dist']);
  const digest = createHash('sha256').update(readFileSync(`.release/${archive}`)).digest('hex');
  writeFileSync(`.release/${archive}.sha256`, `${digest}  ${archive}\n`);
  console.log(`Packaged checked commit ${sha}: sha256:${digest}`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
