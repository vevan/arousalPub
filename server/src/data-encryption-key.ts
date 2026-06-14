import { createHash, randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { DATA_DIR, readConfigFile } from './config.js'

const KEY_FILE = path.join(DATA_DIR, '.data-encryption-key')

let runtimeKeyOverride: Buffer | null = null

export type DataEncryptionKeySource =
  | 'runtime'
  | 'env'
  | 'config'
  | 'file'
  | 'generated'

function readPersistedKey(): string | null {
  if (!existsSync(KEY_FILE)) return null
  const s = readFileSync(KEY_FILE, 'utf8').trim()
  return s.length >= 16 ? s : null
}

function persistGeneratedKey(secret: string): void {
  writeFileSync(KEY_FILE, `${secret}\n`, { mode: 0o600 })
}

/** 将任意长度 secret 规范为 32 字节 AES-256 密钥 */
export function normalizeEncryptionKeyMaterial(material: string): Buffer {
  return createHash('sha256').update(material, 'utf8').digest()
}

/**
 * 磁盘 API Key 加密主密钥：
 * DATA_ENCRYPTION_KEY 环境变量 > config.yaml dataEncryptionKey > data/.data-encryption-key
 */
export function setRuntimeDataEncryptionKey(key: Buffer | null): void {
  runtimeKeyOverride = key
}

export function invalidateDataEncryptionKeyCache(): void {
  // readConfigFile 无进程内缓存；保留 API 供轮换流程调用
}

/** 当前 DEK 来源（不含 runtime 覆盖时的判定顺序） */
export function getDataEncryptionKeySource(): DataEncryptionKeySource {
  if (runtimeKeyOverride) return 'runtime'
  if (process.env.DATA_ENCRYPTION_KEY?.trim()) return 'env'
  const fromCfg = readConfigFile().dataEncryptionKey
  if (typeof fromCfg === 'string' && fromCfg.trim().length >= 16) return 'config'
  if (readPersistedKey()) return 'file'
  return 'generated'
}

/** 将新密钥写入 data/.data-encryption-key（轮换成功后） */
export function persistDataEncryptionKeyMaterial(material: string): void {
  const trimmed = material.trim()
  if (trimmed.length < 16) {
    throw new Error('data_encryption_key_too_short')
  }
  persistGeneratedKey(trimmed)
  invalidateDataEncryptionKeyCache()
}

export function resolveDataEncryptionKey(): Buffer {
  if (runtimeKeyOverride) return runtimeKeyOverride
  const fromEnv = process.env.DATA_ENCRYPTION_KEY?.trim()
  if (fromEnv) return normalizeEncryptionKeyMaterial(fromEnv)

  const fromCfg = readConfigFile().dataEncryptionKey
  if (typeof fromCfg === 'string' && fromCfg.trim().length >= 16) {
    return normalizeEncryptionKeyMaterial(fromCfg.trim())
  }

  const persisted = readPersistedKey()
  if (persisted) return normalizeEncryptionKeyMaterial(persisted)

  const secret = generateDataEncryptionKeyMaterial()
  persistGeneratedKey(secret)
  // eslint-disable-next-line no-console
  console.log(
    `[crypto] 已在 ${KEY_FILE} 生成数据加密密钥（dev/prod 共用；可设 DATA_ENCRYPTION_KEY 或 config.yaml dataEncryptionKey 覆盖）`,
  )
  return normalizeEncryptionKeyMaterial(secret)
}

/** DEK 是否显式配置（环境变量 / config / 持久化文件） */
export function isDataEncryptionKeyConfigured(): boolean {
  if (process.env.DATA_ENCRYPTION_KEY?.trim()) return true
  const fromCfg = readConfigFile().dataEncryptionKey
  if (typeof fromCfg === 'string' && fromCfg.trim().length >= 16) return true
  const persisted = readPersistedKey()
  return persisted != null
}

/** 生成随机 DEK 材料（64 位 hex，与首次落盘格式一致；不落盘） */
export function generateDataEncryptionKeyMaterial(): string {
  return randomBytes(32).toString('hex')
}

/** 测试注入固定密钥 */
export function resolveDataEncryptionKeyForTest(material: string): Buffer {
  return normalizeEncryptionKeyMaterial(material)
}
