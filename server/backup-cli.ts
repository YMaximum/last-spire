import { AccountStore } from './store';
import { createBackup, restoreBackup, verifyBackup } from './backups';

process.umask(0o077);
async function main() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (process.env.NODE_ENV === 'production' && (major !== 22 || minor < 16))
    throw new Error('Unsupported production recovery runtime.');
  const [command, source, target, ...extra] = process.argv.slice(2);
  if (
    !source ||
    extra.length ||
    !['backup', 'verify', 'restore'].includes(command) ||
    (command === 'restore' ? !target : !!target)
  ) {
    throw new Error(
      'Usage: account-backup backup <data-dir> | verify <snapshot> | restore <snapshot> <new-data-dir>',
    );
  }
  if (command === 'backup') {
    const store = new AccountStore(
      source,
      Date.now,
      undefined,
      process.env.LAST_SPIRE_DELETION_JOURNAL,
    );
    try {
      await createBackup(store);
      console.info('Private database backup completed.');
    } finally {
      store.close();
    }
  } else if (command === 'verify') {
    await verifyBackup(source);
    console.info('Backup checksum, integrity and schema verified.');
  } else {
    await restoreBackup(source, target!, process.env.LAST_SPIRE_DELETION_JOURNAL);
    console.info(
      'Restored into new directory; sessions and device locks revoked. Change the service data directory only after stopping it.',
    );
  }
}
void main().catch(() => {
  console.error('Account recovery command failed. No service switch performed.');
  process.exitCode = 1;
});
