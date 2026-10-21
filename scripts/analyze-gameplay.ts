/** Offline analysis of an explicitly selected export. Never contacts a network. */
import { statSync, readFileSync, realpathSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { writeReportFiles } from './analysis/report-files';
import { analyzeLocalExport, localMarkdown } from './analysis/local-report';
import { privateReportPath } from './analysis/balance-report';

if (process.argv.includes('--help')) {
  console.log(
    'Usage: npm run analyze:logs -- --input=LOCAL_EXPORT.json --output=.private/reports/local-analysis.json',
  );
  process.exit(0);
}
const args = new Map<string, string>();
for (const arg of process.argv.slice(2)) {
  const match = /^--(input|output)=(.+)$/.exec(arg);
  if (!match || args.has(match[1])) throw new Error('Use --input and optional --output once each.');
  args.set(match[1], match[2]);
}
const input = args.get('input');
if (!input) throw new Error('Choose an exported local gameplay file with --input.');
const output = privateReportPath(args.get('output') ?? '.private/reports/local-analysis.json');
let data: unknown;
let source: string;
try {
  const stat = statSync(input);
  if (!stat.isFile() || stat.size > 64 * 1024 * 1024)
    throw new Error('Oversized or unsupported export');
  source = realpathSync(input);
  data = JSON.parse(readFileSync(input, 'utf8'));
} catch {
  throw new Error('Could not read a valid gameplay JSON export within the 64 MB limit.');
}
if (
  [output, output.replace(/\.json$/, '.md')].some(
    (p) => resolve(p) === source || (existsSync(p) && realpathSync(p) === source),
  )
)
  throw new Error('Choose another report filename: the source export cannot be replaced.');
const report = analyzeLocalExport(data);
writeReportFiles(output, report, localMarkdown(report));
console.log(
  `Analyzed ${report.inputRuns - report.excludedRuns} records in ${report.groups.length} report groups. Reports remain local.`,
);
