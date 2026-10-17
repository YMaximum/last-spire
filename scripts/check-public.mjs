import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' }).split('\0').filter(Boolean);
const privatePaths = /(?:^|\/)(?:\.private|\.release|\.aws|\.codex|\.agents|\.serena|account-data|reports|playlogs|qa-data|checkpoints)\/|(?:^|\/)docs\/(?:plans\/|RESUME-v2\.md$|VALIDATION\.md$)|(?:^|\/)\.env(?:\.|$)|(?:^|\/)(?:id_rsa|id_ed25519)$|\.sqlite(?:[-.][^/]*)?$|\.(?:pem|key|p12|pfx)$/i;
const secrets = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /gh[pousr]_[A-Za-z0-9]{30,}/,
  /github_pat_[A-Za-z0-9_]{30,}/,
  /AKIA[0-9A-Z]{16}/,
  /\/(?:home|Users)\/[A-Za-z0-9_.-]+\//,
];
const failures = [];
for (const file of files) {
  if (privatePaths.test(file)) failures.push(`${file}: private path`);
  if (/\.(?:png|jpg|jpeg|webp|woff2?|ico)$/.test(file)) continue;
  const text = readFileSync(file, 'utf8');
  if (secrets.some((pattern) => pattern.test(text))) failures.push(`${file}: credential or personal path pattern`);
}
if (failures.length) {
  console.error(failures.join('\n'));
  process.exitCode = 1;
} else console.log(`Public-content check passed (${files.length} files).`);
