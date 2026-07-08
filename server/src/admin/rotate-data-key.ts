import { existsSync } from 'node:fs'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  getDataEncryptionKeySource,
  normalizeEncryptionKeyMaterial,
  persistDataEncryptionKeyMaterial,
  resolveDataEncryptionKey,
  setRuntimeDataEncryptionKey,
  type DataEncryptionKeySource,
} from '../data-encryption-key.js'
import { DATA_DIR, getUserDataDir } from '../config.js'
import {
  acquireMaintenanceLock,
  releaseMaintenanceLock,
} from '../maintenance-lock.js'
import {
  decryptSecret,
  secretToDiskFields,
  type EncryptedSecretV1,
} from '../secret-encryption.js'
import { isValidShortId } from '../short-id.js'
import { readUsersIndex } from '../users-index.js'

export type RotateDataKeyPhase =
  | 'idle'
  | 'locking'
  | 'scanning'
  | 'reencrypting'
  | 'persisting_key'
  | 'done'
  | 'failed'

export interface RotateDataKeyStatus {
  phase: RotateDataKeyPhase
  done: number
  total: number
  errors: string[]
  startedAt: string | null
  finishedAt: string | null
  message: string | null
  keyPersisted: boolean | null
  manualKeySteps: string | null
  dekSource: DataEncryptionKeySource | null
}

interface PendingWrite {
  filePath: string
  content: unknown
  secrets: number
}

interface ApiKeyEntryDisk {
  id: string
  alias: string
  createdAt: string
  updatedAt: string
  key?: string
  keyEnc?: EncryptedSecretV1
}

interface ApiKeysDocumentDisk {
  version: 1
  savedAt: string
  keys: ApiKeyEntryDisk[]
}

type ApiPresetDisk = {
  id: string
  apiKey?: string
  apiKeyEnc?: EncryptedSecretV1
  [key: string]: unknown
}

interface ApiSettingsDocumentDisk {
  version: 1
  savedAt: string
  activePresetId: string
  presets: ApiPresetDisk[]
}

type EmbeddingApiDisk = {
  apiKey?: string
  apiKeyEnc?: EncryptedSecretV1
  [key: string]: unknown
}

interface UserPreferencesDocumentDisk {
  version: 1
  savedAt: string
  embeddingApi?: EmbeddingApiDisk
  [key: string]: unknown
}

const idleStatus = (): RotateDataKeyStatus => ({
  phase: 'idle',
  done: 0,
  total: 0,
  errors: [],
  startedAt: null,
  finishedAt: null,
  message: null,
  keyPersisted: null,
  manualKeySteps: null,
  dekSource: null,
})

let jobStatus: RotateDataKeyStatus = idleStatus()
let jobRunning = false

export function getRotateDataKeyStatus(): RotateDataKeyStatus {
  return { ...jobStatus, errors: [...jobStatus.errors] }
}

function aadForApiKey(userId: string, keyId: string): string {
  return `arousal:${userId}:api-key:${keyId}`
}

function aadForPresetApiKey(userId: string, presetId: string): string {
  return `arousal:${userId}:preset:${presetId}`
}

function aadForEmbeddingApiKey(userId: string): string {
  return `arousal:${userId}:embedding`
}

function resolvePlainForRotation(
  encrypted: EncryptedSecretV1 | undefined,
  aad: string,
  oldKey: Buffer,
): string {
  if (!encrypted) return ''
  return decryptSecret(encrypted, { key: oldKey, aad })
}

function reencryptSecretField(
  encrypted: EncryptedSecretV1 | undefined,
  aad: string,
  oldKey: Buffer,
  newKey: Buffer,
): { changed: boolean; keyEnc?: EncryptedSecretV1 } {
  const plain = resolvePlainForRotation(encrypted, aad, oldKey)
  if (!plain.trim()) return { changed: false }
  const { keyEnc } = secretToDiskFields(plain, { key: newKey, aad })
  return { changed: true, keyEnc }
}

export function rotateApiKeysDocument(
  doc: ApiKeysDocumentDisk,
  userId: string,
  oldKey: Buffer,
  newKey: Buffer,
): { doc: ApiKeysDocumentDisk; count: number } {
  let count = 0
  const keys = doc.keys.map((entry) => {
    const { changed, keyEnc } = reencryptSecretField(
      entry.keyEnc,
      aadForApiKey(userId, entry.id),
      oldKey,
      newKey,
    )
    if (!changed) {
      const { key: _k, keyEnc: _e, ...rest } = entry
      return rest as ApiKeyEntryDisk
    }
    count++
    const { key: _k, keyEnc: _e, ...rest } = entry
    return { ...rest, keyEnc } as ApiKeyEntryDisk
  })
  return { doc: { ...doc, keys }, count }
}

export function rotateApiSettingsDocument(
  doc: ApiSettingsDocumentDisk,
  userId: string,
  oldKey: Buffer,
  newKey: Buffer,
): { doc: ApiSettingsDocumentDisk; count: number } {
  let count = 0
  const presets = doc.presets.map((preset) => {
    const { changed, keyEnc } = reencryptSecretField(
      preset.apiKeyEnc,
      aadForPresetApiKey(userId, preset.id),
      oldKey,
      newKey,
    )
    if (!changed) {
      const { apiKey: _k, apiKeyEnc: _e, ...rest } = preset
      return rest as ApiPresetDisk
    }
    count++
    const { apiKey: _k, apiKeyEnc: _e, ...rest } = preset
    return { ...rest, apiKeyEnc: keyEnc } as ApiPresetDisk
  })
  return { doc: { ...doc, presets }, count }
}

export function rotateUserPreferencesDocument(
  doc: UserPreferencesDocumentDisk,
  userId: string,
  oldKey: Buffer,
  newKey: Buffer,
): { doc: UserPreferencesDocumentDisk; count: number } {
  const raw = doc.embeddingApi
  if (!raw || typeof raw !== 'object') {
    return { doc, count: 0 }
  }
  const { changed, keyEnc } = reencryptSecretField(
    raw.apiKeyEnc,
    aadForEmbeddingApiKey(userId),
    oldKey,
    newKey,
  )
  if (!changed) {
    const { apiKey: _k, apiKeyEnc: _e, ...rest } = raw
    return { doc: { ...doc, embeddingApi: rest }, count: 0 }
  }
  const { apiKey: _k, apiKeyEnc: _e, ...rest } = raw
  return {
    doc: { ...doc, embeddingApi: { ...rest, apiKeyEnc: keyEnc } },
    count: 1,
  }
}

async function listUserIds(): Promise<string[]> {
  const ids = new Set<string>()
  try {
    const doc = await readUsersIndex()
    for (const u of doc.users) ids.add(u.id)
  } catch {
    /* ignore */
  }
  try {
    const names = await readdir(DATA_DIR)
    for (const n of names) {
      if (isValidShortId(n)) ids.add(n)
    }
  } catch {
    /* ignore */
  }
  return [...ids]
}

async function readJsonFile(filePath: string): Promise<unknown | null> {
  if (!existsSync(filePath)) return null
  const raw = await readFile(filePath, 'utf8')
  return JSON.parse(raw) as unknown
}

function countSecretsInPending(pending: PendingWrite[]): number {
  return pending.reduce((n, p) => n + p.secrets, 0)
}

async function buildPendingWrites(
  userIds: string[],
  oldKey: Buffer,
  newKey: Buffer,
): Promise<{ pending: PendingWrite[]; errors: string[] }> {
  const pending: PendingWrite[] = []
  const errors: string[] = []

  for (const userId of userIds) {
    const root = getUserDataDir(userId)

    const apiKeysPath = path.join(root, 'api-keys.json')
    const apiKeysRaw = await readJsonFile(apiKeysPath)
    if (apiKeysRaw) {
      try {
        const doc = apiKeysRaw as ApiKeysDocumentDisk
        if (!Array.isArray(doc.keys)) throw new Error('invalid keys array')
        const rotated = rotateApiKeysDocument(doc, userId, oldKey, newKey)
        if (rotated.count > 0) {
          pending.push({
            filePath: apiKeysPath,
            content: rotated.doc,
            secrets: rotated.count,
          })
        }
      } catch (e) {
        errors.push(
          `${apiKeysPath}: ${e instanceof Error ? e.message : 'read_failed'}`,
        )
      }
    }

    const apiSettingsPath = path.join(root, 'api-settings.json')
    const apiSettingsRaw = await readJsonFile(apiSettingsPath)
    if (apiSettingsRaw) {
      try {
        const doc = apiSettingsRaw as ApiSettingsDocumentDisk
        if (!Array.isArray(doc.presets)) throw new Error('invalid presets array')
        const rotated = rotateApiSettingsDocument(doc, userId, oldKey, newKey)
        if (rotated.count > 0) {
          pending.push({
            filePath: apiSettingsPath,
            content: rotated.doc,
            secrets: rotated.count,
          })
        }
      } catch (e) {
        errors.push(
          `${apiSettingsPath}: ${e instanceof Error ? e.message : 'read_failed'}`,
        )
      }
    }

    const prefsPath = path.join(root, 'user-preferences.json')
    const prefsRaw = await readJsonFile(prefsPath)
    if (prefsRaw) {
      try {
        const doc = prefsRaw as UserPreferencesDocumentDisk
        const rotated = rotateUserPreferencesDocument(doc, userId, oldKey, newKey)
        if (rotated.count > 0) {
          pending.push({
            filePath: prefsPath,
            content: rotated.doc,
            secrets: rotated.count,
          })
        }
      } catch (e) {
        errors.push(
          `${prefsPath}: ${e instanceof Error ? e.message : 'read_failed'}`,
        )
      }
    }
  }

  return { pending, errors }
}

function manualKeyStepsForSource(source: DataEncryptionKeySource): string | null {
  if (source === 'env') {
    return '请更新 DATA_ENCRYPTION_KEY 环境变量为相同的新密钥材料，并重启服务。'
  }
  if (source === 'config') {
    return '请更新 config.yaml 的 dataEncryptionKey 为相同的新密钥材料，并重启服务。'
  }
  return null
}

async function runRotateJob(newKeyMaterial: string): Promise<void> {
  const startedAt = new Date().toISOString()
  const dekSource = getDataEncryptionKeySource()
  jobStatus = {
    phase: 'locking',
    done: 0,
    total: 0,
    errors: [],
    startedAt,
    finishedAt: null,
    message: '已加写锁',
    keyPersisted: null,
    manualKeySteps: null,
    dekSource,
  }

  acquireMaintenanceLock('dek_rotation')

  try {
    const oldKey = resolveDataEncryptionKey()
    const newKey = normalizeEncryptionKeyMaterial(newKeyMaterial)

    jobStatus = { ...jobStatus, phase: 'scanning', message: '扫描用户与密文…' }
    const userIds = await listUserIds()
    const { pending, errors } = await buildPendingWrites(
      userIds,
      oldKey,
      newKey,
    )

    if (errors.length > 0) {
      jobStatus = {
        ...jobStatus,
        phase: 'failed',
        errors,
        finishedAt: new Date().toISOString(),
        message: '扫描/解密失败，未写入任何文件',
      }
      return
    }

    const total = countSecretsInPending(pending)
    jobStatus = {
      ...jobStatus,
      phase: 'reencrypting',
      total,
      message:
        total > 0
          ? `重加密 ${pending.length} 个文件、${total} 处密钥…`
          : '未发现需重加密的密钥',
    }

    let done = 0
    for (const item of pending) {
      await writeFile(
        item.filePath,
        `${JSON.stringify(item.content, null, 2)}\n`,
        'utf8',
      )
      done += item.secrets
      jobStatus = { ...jobStatus, done }
    }

    jobStatus = {
      ...jobStatus,
      phase: 'persisting_key',
      message: '更新主密钥…',
    }

    const sourceBeforePersist = getDataEncryptionKeySource()
    const manual = manualKeyStepsForSource(sourceBeforePersist)
    let keyPersisted = false

    if (manual) {
      setRuntimeDataEncryptionKey(newKey)
      jobStatus = {
        ...jobStatus,
        keyPersisted: false,
        manualKeySteps: manual,
      }
    } else {
      persistDataEncryptionKeyMaterial(newKeyMaterial.trim())
      setRuntimeDataEncryptionKey(newKey)
      keyPersisted = true
    }

    jobStatus = {
      ...jobStatus,
      phase: 'done',
      done: total,
      finishedAt: new Date().toISOString(),
      message: keyPersisted
        ? '轮换完成，已写入 data/.data-encryption-key'
        : '轮换完成，请按提示更新环境变量/配置并重启',
      keyPersisted,
    }
  } catch (e) {
    jobStatus = {
      ...jobStatus,
      phase: 'failed',
      errors: [e instanceof Error ? e.message : 'rotate_failed'],
      finishedAt: new Date().toISOString(),
      message: '轮换失败，数据未变更或已中止',
    }
  } finally {
    releaseMaintenanceLock()
    jobRunning = false
  }
}

export function startRotateDataKeyJob(
  newKeyMaterial: string,
): { ok: true } | { error: string } {
  if (jobRunning) return { error: 'admin_rotate_in_progress' }
  const trimmed = newKeyMaterial.trim()
  if (trimmed.length < 16) return { error: 'admin_rotate_invalid_key' }

  const oldKey = resolveDataEncryptionKey()
  const newKey = normalizeEncryptionKeyMaterial(trimmed)
  if (oldKey.equals(newKey)) return { error: 'admin_rotate_same_key' }

  jobRunning = true
  jobStatus = {
    ...idleStatus(),
    phase: 'locking',
    startedAt: new Date().toISOString(),
    message: '启动中…',
    dekSource: getDataEncryptionKeySource(),
  }

  void runRotateJob(trimmed)
  return { ok: true }
}

/** 测试用：重置任务状态 */
export function resetRotateDataKeyJobForTest(): void {
  jobRunning = false
  jobStatus = idleStatus()
}
