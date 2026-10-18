import { resolve } from 'node:path';
import { accountServer, validateConfig } from './app';
import { googleVerifier, googleCodeVerifier } from './identity';
import { readGoogleClientSecret } from './secrets';
import { AccountStore } from './store';
import { createBackup } from './backups';

const origin = process.env.LAST_SPIRE_ORIGIN ?? '';
const clientId = process.env.GOOGLE_CLIENT_ID ?? '';
const directory = process.env.LAST_SPIRE_DATA_DIR;
const port = Number(process.env.LAST_SPIRE_API_PORT ?? 8092);
const bind = process.env.LAST_SPIRE_API_BIND ?? '127.0.0.1';
if (!['127.0.0.1', '0.0.0.0'].includes(bind)) throw new Error('Invalid API bind address.');
if (!directory || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Set an absolute LAST_SPIRE_DATA_DIR and an unprivileged API port.');
if (resolve(directory) !== directory) throw new Error('The data directory must be absolute.');
process.umask(0o077);
const [nodeMajor, nodeMinor] = process.versions.node.split('.').map(Number);
if (process.env.NODE_ENV === 'production' && (nodeMajor !== 22 || nodeMinor < 16))
  throw new Error('Production account services require Node 22.16 or newer within Node 22.');
const config = validateConfig({
  origin,
  clientId,
  development: process.env.NODE_ENV === 'development',
  trustProxy: process.env.LAST_SPIRE_TRUST_PROXY === '1',
  releaseCommit: process.env.LAST_SPIRE_RELEASE_COMMIT,
  trustedProxyAddress: process.env.LAST_SPIRE_PROXY_ADDRESS,
});
const deletionJournal = process.env.LAST_SPIRE_DELETION_JOURNAL;
const secretFile = process.env.GOOGLE_CLIENT_SECRET_FILE;
if (!config.development && (!deletionJournal || !secretFile))
  throw new Error(
    'Configure the stable deletion journal and private production secret before startup.',
  );
const verifyCode = secretFile
  ? googleCodeVerifier(clientId, readGoogleClientSecret(secretFile), origin)
  : undefined;
const store = new AccountStore(directory, Date.now, undefined, deletionJournal);
const server = accountServer(store, config, googleVerifier(clientId), verifyCode);
let backupBusy = false;
async function dailyBackup() {
  if (backupBusy) return;
  backupBusy = true;
  try {
    await createBackup(store);
  } catch {
    console.error('Account backup failed; operator attention required.');
  } finally {
    backupBusy = false;
  }
}
const backupTimer = setInterval(() => void dailyBackup(), 24 * 60 * 60 * 1000);
backupTimer.unref();
server.listen(port, bind, () => console.info('Last Spire account service started.'));
void dailyBackup();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => {
    clearInterval(backupTimer);
    server.close(() => {
      const finish = () => {
        if (backupBusy) {
          setTimeout(finish, 50);
          return;
        }
        store.close();
        process.exit(0);
      };
      finish();
    });
  });
}
