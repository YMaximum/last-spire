import { AccountStore } from './store';
import { createBackup, restoreBackup, verifyBackup } from './backups';

process.umask(0o077);
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
  const store = new AccountStore(source);
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
  await restoreBackup(source, target!);
  console.info(
    'Restored into new directory; sessions and device locks revoked. Change the service data directory only after stopping it.',
  );
}
