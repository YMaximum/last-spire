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
if (!directory || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Set an absolute LAST_SPIRE_DATA_DIR and an unprivileged API port.');
if (resolve(directory) !== directory) throw new Error('The data directory must be absolute.');
process.umask(0o077);
const config = validateConfig({
  origin,
  clientId,
  development: process.env.NODE_ENV === 'development',
  trustProxy: process.env.LAST_SPIRE_TRUST_PROXY === '1',
});
const store = new AccountStore(directory);
const secretFile = process.env.GOOGLE_CLIENT_SECRET_FILE;
const verifyCode = secretFile
  ? googleCodeVerifier(clientId, readGoogleClientSecret(secretFile), origin)
  : undefined;
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
server.listen(port, '127.0.0.1', () =>
  console.info('Last Spire account service listening on loopback.'),
);
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
