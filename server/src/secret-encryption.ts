import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { resolveDataEncryptionKey } from './data-encryption-key.js'

const ALG = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

export interface EncryptedSecretV1 {
  v: 1
  iv: string
  tag: string
  ct: string
}

export function isEncryptedSecretV1(x: unknown): x is EncryptedSecretV1 {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return false
  const o = x as Partial<EncryptedSecretV1>
  return (
    o.v === 1 &&
    typeof o.iv === 'string' &&
    o.iv.length > 0 &&
    typeof o.tag === 'string' &&
    o.tag.length > 0 &&
    typeof o.ct === 'string'
  )
}

export interface SecretCryptoOptions {
  /** 附加认证数据，如 userId + 字段上下文 */
  aad?: string
  /** 测试或轮换时显式传入密钥 */
  key?: Buffer
}

export function encryptSecret(
  plaintext: string,
  opts: SecretCryptoOptions = {},
): EncryptedSecretV1 {
  const key = opts.key ?? resolveDataEncryptionKey()
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALG, key, iv, { authTagLength: TAG_LEN })
  if (opts.aad) cipher.setAAD(Buffer.from(opts.aad, 'utf8'))
  const ct = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const tag = cipher.getAuthTag()
  return {
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ct: ct.toString('base64'),
  }
}

export function decryptSecret(
  blob: EncryptedSecretV1,
  opts: SecretCryptoOptions = {},
): string {
  const key = opts.key ?? resolveDataEncryptionKey()
  const iv = Buffer.from(blob.iv, 'base64')
  const tag = Buffer.from(blob.tag, 'base64')
  const ct = Buffer.from(blob.ct, 'base64')
  const decipher = createDecipheriv(ALG, key, iv, { authTagLength: TAG_LEN })
  if (opts.aad) decipher.setAAD(Buffer.from(opts.aad, 'utf8'))
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(ct), decipher.final()])
  return plain.toString('utf8')
}

/** 读盘：仅解密 keyEnc；明文 apiKey 字段不再读取 */
export function resolveSecretFromDisk(
  encrypted: EncryptedSecretV1 | undefined,
  opts: SecretCryptoOptions,
): string {
  if (encrypted) {
    return decryptSecret(encrypted, opts)
  }
  return ''
}

/** 写盘：非空则加密，空则两者皆省略 */
export function secretToDiskFields(
  plaintext: string,
  opts: SecretCryptoOptions,
): { keyEnc?: EncryptedSecretV1 } {
  const trimmed = plaintext.trim()
  if (!trimmed) return {}
  return { keyEnc: encryptSecret(trimmed, opts) }
}
