import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createServer, type ViteDevServer } from 'vite';
import config from '../vite.config';

describe('development file boundaries', () => {
  let root: string;
  let server: ViteDevServer;
  let base: string;
  const privateFiles = ['.private/probe.txt', '.env', '.aws/credentials', 'id_ed25519',
    'reports/probe.txt', 'qa-data/probe.json', 'checkpoints/run.json', 'playlogs/probe.json',
    'account-data/probe.json', 'accounts.sqlite', 'accounts.sqlite-wal', 'server/probe.ts'];

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'last-spire-boundary-'));
    await writeFile(join(root, 'index.html'), '<h1>Last Spire test</h1>');
    for (const file of privateFiles) {
      await mkdir(dirname(join(root, file)), { recursive: true });
      await writeFile(join(root, file), 'LOCAL_SENTINEL_DO_NOT_SERVE');
    }
    server = await createServer({ ...config, configFile: false, root, logLevel: 'silent',
      server: { ...config.server, port: 0, watch: null, fs: { ...config.server?.fs, allow: [root] } },
      optimizeDeps: { noDiscovery: true, include: [] } });
    await server.listen();
    const address = server.httpServer!.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    base = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    await server?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  it('binds loopback and serves the normal entrypoint', async () => {
    const address = server.httpServer!.address();
    expect(address && typeof address !== 'string' && address.address).toBe('127.0.0.1');
    expect((await fetch(base)).status).toBe(200);
  });

  it.each(privateFiles)('refuses direct and filesystem access to %s', async (file) => {
    for (const path of [`/${file}`, `/@fs${root}/${file}`]) {
      const response = await fetch(base + path);
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain('LOCAL_SENTINEL_DO_NOT_SERVE');
    }
  });
});
