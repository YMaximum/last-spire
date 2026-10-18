import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AccountStore, MAX_DELETION_BYTES, readDeletions } from '../server/store';
import { createBackup, restoreBackup } from '../server/backups';
const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'spire-deletion-test-'));
  roots.push(root);
  const store = new AccountStore(root);
  const create = (subject: string) =>
    store.login(store.bootstrap().session, { subject, name: 'Synthetic keeper' });
  return { root, store, create };
}
describe('deletion-safe recovery', () => {
  it('applies canonical deletion markers to older backups without deleting unrelated or newly recreated accounts', async () => {
    const f = fixture(),
      a = f.create('subject-a'),
      b = f.create('subject-b');
    const snapshot = await createBackup(f.store),
      journal = f.store.deletionJournal;
    f.store.deleteAccount(a.session);
    const recreated = f.create('subject-a');
    expect(recreated.player.id).not.toBe(a.player.id);
    const markers = readFileSync(journal, 'utf8');
    expect(markers).toBe(a.player.id + '\n');
    expect(markers).not.toContain('subject-a');
    expect(markers).not.toContain('Synthetic');
    const target = join(f.root, 'restored');
    await restoreBackup(snapshot, target, journal);
    const restored = new AccountStore(target, Date.now, undefined, journal);
    expect(() => restored.player(a.player.id)).toThrow('unauthenticated');
    expect(restored.player(b.player.id)).toEqual(b.player);
    expect(restored.session(b.raw)).toBeNull();
    expect(restored.generation).not.toBe(f.store.generation);
    expect(f.store.player(recreated.player.id)).toEqual(recreated.player);
    restored.close();
    f.store.close();
  });
  it('completes a durable deletion intent after interruption before the database transaction', () => {
    const f = fixture(),
      a = f.create('a'),
      b = f.create('b');
    writeFileSync(f.store.deletionJournal, a.player.id + '\n');
    f.store.close();
    const reopened = new AccountStore(f.root);
    expect(() => reopened.player(a.player.id)).toThrow('unauthenticated');
    expect(reopened.player(b.player.id)).toEqual(b.player);
    reopened.close();
  });
  it('refuses missing or malformed canonical journals before creating a recovery database', async () => {
    const f = fixture(),
      snapshot = await createBackup(f.store);
    const target = join(f.root, 'bad-recovery');
    await expect(restoreBackup(snapshot, target, join(f.root, 'missing'))).rejects.toThrow();
    expect(existsSync(join(target, 'accounts.sqlite'))).toBe(false);
    writeFileSync(f.store.deletionJournal, 'incomplete-record');
    await expect(restoreBackup(snapshot, target, f.store.deletionJournal)).rejects.toThrow(
      'invalid_deletion_journal',
    );
    expect(existsSync(join(target, 'accounts.sqlite'))).toBe(false);
    f.store.close();
  });
  it('fails safely when the bounded journal is full and retains the account', () => {
    const f = fixture(),
      a = f.create('a');
    const line = '11111111-1111-4111-8111-111111111111\n';
    writeFileSync(
      f.store.deletionJournal,
      line.repeat(Math.floor(MAX_DELETION_BYTES / line.length)),
    );
    expect(() => f.store.deleteAccount(a.session)).toThrow('deletion_journal_full');
    expect(f.store.player(a.player.id)).toEqual(a.player);
    f.store.close();
  });
  it('does not duplicate a durable intent when the live database deletion is retried', () => {
    const f = fixture(),
      a = f.create('a');
    writeFileSync(f.store.deletionJournal, a.player.id + '\n');
    f.store.deleteAccount(a.session);
    expect(readDeletions(f.store.deletionJournal).size).toBe(1);
    expect(readFileSync(f.store.deletionJournal, 'utf8')).toBe(a.player.id + '\n');
    f.store.close();
  });
});
