import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
const run = promisify(execFile);
const COMMIT = 'a'.repeat(40);
const FAKE_SECRET = 'bundle-fixture-not-a-real-google-credential';

describe.skipIf(Number(process.versions.node.split('.')[0]) !== 22)(
  'standalone production API on Node 22',
  () => {
    let root: string, child: ChildProcess, port: number, env: NodeJS.ProcessEnv;
    beforeAll(async () => {
      await run(process.execPath, ['scripts/build-api.mjs'], { timeout: 20_000 });
      root = mkdtempSync(join(tmpdir(), 'spire-api-bundle-'));
      mkdirSync(join(root, 'data'), { mode: 0o700 });
      for (const file of ['main.cjs', 'backup.cjs'])
        copyFileSync(resolve('.account-build', file), join(root, file));
      writeFileSync(join(root, 'secret'), FAKE_SECRET, { mode: 0o600 });
      writeFileSync(join(root, 'deletions.jsonl'), '', { mode: 0o600 });
      const socket = createServer();
      await new Promise<void>((r) => socket.listen(0, '127.0.0.1', r));
      const address = socket.address();
      if (!address || typeof address === 'string') throw new Error('No test port');
      port = address.port;
      await new Promise<void>((r, j) => socket.close((e) => (e ? j(e) : r())));
      env = {
        ...process.env,
        NODE_PATH: '',
        NODE_ENV: 'production',
        GOOGLE_CLIENT_ID: '123-fixture.apps.googleusercontent.com',
        GOOGLE_CLIENT_SECRET_FILE: join(root, 'secret'),
        LAST_SPIRE_DATA_DIR: join(root, 'data'),
        LAST_SPIRE_ORIGIN: 'https://game.example.test',
        LAST_SPIRE_API_PORT: String(port),
        LAST_SPIRE_API_BIND: '127.0.0.1',
        LAST_SPIRE_RELEASE_COMMIT: COMMIT,
        LAST_SPIRE_DELETION_JOURNAL: join(root, 'deletions.jsonl'),
        LAST_SPIRE_TRUST_PROXY: '0',
        LAST_SPIRE_PROXY_ADDRESS: undefined,
      };
      child = spawn(process.execPath, [join(root, 'main.cjs')], {
        cwd: root,
        env,
        stdio: 'ignore',
      });
      for (let attempt = 0; attempt < 100; attempt++) {
        if (child.exitCode !== null) throw new Error('Standalone bundle exited before health');
        try {
          const response = await fetch(`http://127.0.0.1:${port}/api/healthz`);
          if (response.ok) return;
        } catch {}
        await new Promise((r) => setTimeout(r, 30));
      }
      throw new Error('Standalone bundle did not become healthy');
    }, 25_000);
    afterAll(async () => {
      if (child && child.exitCode === null) {
        await new Promise<void>((r) => {
          const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
          child.once('exit', () => {
            clearTimeout(timer);
            r();
          });
          child.kill('SIGTERM');
        });
      }
      if (root) rmSync(root, { recursive: true, force: true });
    });
    it('runs without node_modules and serves versioned health with protected sessions', async () => {
      const base = `http://127.0.0.1:${port}`;
      expect(await (await fetch(base + '/api/healthz')).json()).toEqual({
        ok: true,
        schema: 1,
        commit: COMMIT,
        database: 2,
        runtime: 22,
      });
      const response = await fetch(base + '/api/session');
      const session = await response.json();
      expect(session.codeSignIn).toBe(true);
      expect(session.player).toBeNull();
      expect(response.headers.get('set-cookie')).toContain('__Host-last-spire=');
      expect(response.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
      expect(response.headers.get('set-cookie')).toContain('; Secure');
      expect((await fetch(base + '/api/save')).status).toBe(401);
    });
    it('runs its bundled backup/restore CLI offline and rotates restored session generation', async () => {
      await run(process.execPath, [join(root, 'backup.cjs'), 'backup', join(root, 'data')], {
        cwd: root,
        env,
        timeout: 10_000,
      });
      const name = readdirSync(join(root, 'data/backups')).find((n) => n.endsWith('.sqlite'))!;
      expect(name).toMatch(/^snapshot-/);
      const snapshot = join(root, 'data/backups', name),
        target = join(root, 'restored');
      await run(process.execPath, [join(root, 'backup.cjs'), 'verify', snapshot], {
        cwd: root,
        env,
        timeout: 10_000,
      });
      await run(process.execPath, [join(root, 'backup.cjs'), 'restore', snapshot, target], {
        cwd: root,
        env,
        timeout: 10_000,
      });
      const oldDb = new DatabaseSync(snapshot, { readOnly: true }),
        newDb = new DatabaseSync(join(target, 'accounts.sqlite'), { readOnly: true });
      try {
        expect(newDb.prepare('SELECT count(*) AS n FROM sessions').get()!.n).toBe(0);
        expect(
          newDb.prepare("SELECT value FROM metadata WHERE key='generation'").get()!.value,
        ).not.toBe(oldDb.prepare("SELECT value FROM metadata WHERE key='generation'").get()!.value);
      } finally {
        oldDb.close();
        newDb.close();
      }
      expect(readFileSync(join(root, 'data/backups', name + '.sha256'), 'utf8')).toMatch(
        /^[a-f0-9]{64}\n$/,
      );
    });
    it('fails closed without canonical production recovery configuration before creating a database', async () => {
      const target = join(root, 'unconfigured');
      mkdirSync(target, { mode: 0o700 });
      try {
        await run(process.execPath, [join(root, 'main.cjs')], {
          cwd: root,
          env: { ...env, LAST_SPIRE_DATA_DIR: target, LAST_SPIRE_DELETION_JOURNAL: '' },
          timeout: 5000,
        });
        throw new Error('Unexpected startup');
      } catch (error) {
        expect((error as { code?: number }).code).toBe(1);
        expect(String((error as { stderr?: string }).stderr)).not.toContain(FAKE_SECRET);
        expect(existsSync(join(target, 'accounts.sqlite'))).toBe(false);
      }
    });
  },
);
