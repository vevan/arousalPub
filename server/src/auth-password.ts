import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const scryptAsync = promisify(scrypt)

const SCRYPT_N = 16384
const KEY_LEN = 64

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = (await scryptAsync(password, salt, KEY_LEN)) as Buffer
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${derived.toString('base64')}`
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  if (!stored || !password) return false
  const parts = stored.split('$')
  if (parts.length !== 4 || parts[0] !== 'scrypt') return false
  const salt = Buffer.from(parts[2]!, 'base64')
  const expected = Buffer.from(parts[3]!, 'base64')
  const derived = (await scryptAsync(password, salt, expected.length)) as Buffer
  if (derived.length !== expected.length) return false
  return timingSafeEqual(derived, expected)
}
