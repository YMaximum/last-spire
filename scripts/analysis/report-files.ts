import { mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { privateReportPath } from './balance-report';

/** A killed audit leaves its last complete JSON checkpoint readable. */
export function writeReportFiles(path: string, report: unknown, markdown: string): void {
  const output = privateReportPath(path);
  mkdirSync(dirname(output), { recursive: true, mode: 0o700 });
  const atomic = (target: string, text: string) => {
    const temporary = `${target}.${randomUUID()}.tmp`;
    writeFileSync(temporary, text, { flag: 'wx', mode: 0o600 });
    try {
      renameSync(temporary, target);
    } catch (error) {
      unlinkSync(temporary);
      throw error;
    }
  };
  atomic(output, JSON.stringify(report, null, 2));
  atomic(output.replace(/\.json$/, '.md'), markdown);
}
