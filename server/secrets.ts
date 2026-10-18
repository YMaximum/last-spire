import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

/** Read only a private regular file; errors never contain its path or contents. */
export function readGoogleClientSecret(path: string): string {
  let fd: number | undefined;
  try {
    if (!isAbsolute(path)) throw new Error();
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || stat.size < 16 || stat.size > 512)
      throw new Error();
    const secret = readFileSync(fd, 'utf8').trim();
    if (!/^[A-Za-z0-9_-]{16,256}$/.test(secret)) throw new Error();
    return secret;
  } catch {
    throw new Error('Google sign-in requires a valid private client-secret file (mode 600).');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
