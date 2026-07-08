import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { generateShortId } from './short-id.js'
import { getApiSettingsPath, getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'
import {
  isEncryptedSecretV1,
  resolveSecretFromDisk,
  secretToDiskFields,
  type EncryptedSecretV1,
} from './secret-encryption.js'

export function getApiSettingsPathForUser(): string {
  return getApiSettingsPath()
}

/** 单条预设（与前端 ApiPreset 一致） */
export interface ApiPreset {
  id: string
  alias: string
  baseUrl: string
  apiKey: string
  model: string
  contextLength: number | null
  maxTokens: number | null
  stream: boolean
  temperature: number | null
  topP: number | null
  topK: number | null
  dryMultiplier: number | null
  dryBase: number | null
  dryAllowedLength: number | null
  dryPenaltyLastN: number | null
  drySequenceBreakers: string[]
  frequencyPenalty: number | null
  presencePenalty: number | null
  customParamsJson: string
  showReasoningChain: boolean
  requestReasoningChain: boolean
  linkedPromptPresetId?: string | null
  apiKeyId?: string | null
}

export interface ApiSettingsDocument {
  version: 1
  savedAt: string
  activePresetId: string
  presets: ApiPreset[]
}

type ApiPresetDisk = Omit<ApiPreset, 'apiKey'> & {
  apiKey?: string
  apiKeyEnc?: EncryptedSecretV1
}

interface ApiSettingsDocumentDisk {
  version: 1
  savedAt: string
  activePresetId: string
  presets: ApiPresetDisk[]
  /** 遗留字段；读盘忽略，写盘不再输出 */
  featureBindings?: unknown
}

function aadForPresetApiKey(userId: string, presetId: string): string {
  return `arousal:${userId}:preset:${presetId}`
}

function presetDiskToMemory(raw: ApiPresetDisk, userId: string): ApiPreset {
  const apiKey = resolveSecretFromDisk(raw.apiKeyEnc, {
    aad: aadForPresetApiKey(userId, raw.id),
  })
  const { apiKey: _p, apiKeyEnc: _e, ...rest } = raw
  return { ...rest, apiKey } as ApiPreset
}

function presetMemoryToDisk(preset: ApiPreset, userId: string): ApiPresetDisk {
  const { apiKey, ...rest } = preset
  const { keyEnc: apiKeyEnc } = secretToDiskFields(apiKey, {
    aad: aadForPresetApiKey(userId, preset.id),
  })
  const disk: ApiPresetDisk = { ...rest }
  if (apiKeyEnc) disk.apiKeyEnc = apiKeyEnc
  return disk
}

function isApiPresetDisk(p: unknown): p is ApiPresetDisk {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return false
  const o = p as Partial<ApiPresetDisk>
  if (typeof o.id !== 'string' || !o.id.length) return false
  if (o.apiKey !== undefined && typeof o.apiKey !== 'string') return false
  if (o.apiKeyEnc !== undefined && !isEncryptedSecretV1(o.apiKeyEnc)) {
    return false
  }
  return true
}

function normalizeActivePresetId(
  activePresetId: string,
  presets: ApiPreset[],
): string {
  let active = activePresetId.trim()
  if (!presets.some((p) => p.id === active)) {
    active = presets[0]?.id ?? active
  }
  return active
}

function normalizeDocumentFromDisk(
  o: unknown,
  userId: string,
): ApiSettingsDocument | null {
  if (!o || typeof o !== 'object') return null
  const d = o as Partial<ApiSettingsDocumentDisk>
  if (d.version !== 1 || !Array.isArray(d.presets)) return null
  const presetsRaw = (d.presets as unknown[]).filter(isApiPresetDisk)
  if (presetsRaw.length === 0) return null
  const presets: ApiPreset[] = presetsRaw.map((p) => {
    const m = p as Partial<ApiPresetDisk>
    const breakers = Array.isArray(m.drySequenceBreakers)
      ? m.drySequenceBreakers.filter((x): x is string => typeof x === 'string')
      : []
    const withMeta: ApiPresetDisk = {
      ...(m as ApiPresetDisk),
      drySequenceBreakers: breakers,
      linkedPromptPresetId:
        typeof m.linkedPromptPresetId === 'string' &&
        m.linkedPromptPresetId.trim()
          ? m.linkedPromptPresetId.trim()
          : null,
      apiKeyId:
        typeof m.apiKeyId === 'string' && m.apiKeyId.trim()
          ? m.apiKeyId.trim()
          : null,
    }
    return presetDiskToMemory(withMeta, userId)
  })
  const active = normalizeActivePresetId(
    typeof d.activePresetId === 'string' ? d.activePresetId : presets[0].id,
    presets,
  )
  return {
    version: 1,
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : new Date().toISOString(),
    activePresetId: active,
    presets,
  }
}

export function normalizeApiSettingsDocument(
  data: ApiSettingsDocument,
): ApiSettingsDocument {
  assertValidPresets(data.presets)
  return {
    version: 1,
    savedAt: data.savedAt,
    activePresetId: normalizeActivePresetId(data.activePresetId, data.presets),
    presets: data.presets,
  }
}

function documentToDisk(
  data: ApiSettingsDocument,
  userId: string,
): ApiSettingsDocumentDisk {
  const normalized = normalizeApiSettingsDocument(data)
  return {
    version: 1,
    savedAt: normalized.savedAt,
    activePresetId: normalized.activePresetId,
    presets: normalized.presets.map((p) => presetMemoryToDisk(p, userId)),
  }
}

export async function readApiSettingsFromFile(): Promise<ApiSettingsDocument | null> {
  try {
    const raw = await readFile(getApiSettingsPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return normalizeDocumentFromDisk(parsed, getCurrentUserId())
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

export async function writeApiSettingsToFile(
  data: ApiSettingsDocument,
): Promise<void> {
  const userId = getCurrentUserId()
  await mkdir(getUserDataDir(userId), { recursive: true })
  const disk = documentToDisk(data, userId)
  await writeFile(getApiSettingsPath(), `${JSON.stringify(disk, null, 2)}\n`, 'utf8')
}

export function assertValidCustomParamsJson(customParamsJson: string): void {
  const t = customParamsJson.trim()
  if (!t) return
  const parsed: unknown = JSON.parse(t)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('自定义参数须为 JSON 对象')
  }
}

export function assertValidPresets(presets: ApiPreset[]): void {
  if (!Array.isArray(presets) || presets.length === 0) {
    throw new Error('至少保留一条 API 预设')
  }
  for (const p of presets) {
    assertValidCustomParamsJson(p.customParamsJson)
  }
}

export function newApiPresetId(): string {
  return generateShortId()
}
