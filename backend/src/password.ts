import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);
const keyLength = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = (await scrypt(password, salt, keyLength)) as Buffer;
  return `scrypt$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encodedHash: string): Promise<boolean> {
  const [algorithm, salt, storedKey] = encodedHash.split('$');
  if (algorithm !== 'scrypt' || !salt || !storedKey || !/^[\da-f]{128}$/i.test(storedKey)) {
    return false;
  }

  const derivedKey = (await scrypt(password, salt, keyLength)) as Buffer;
  return timingSafeEqual(derivedKey, Buffer.from(storedKey, 'hex'));
}
