import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { generateShortId } from './short-id.js'
import { getApiSettingsPath, getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'

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
  dry: number | null
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

function normalizeDocument(o: unknown): ApiSettingsDocument | null {
  if (!o || typeof o !== 'object') return null
  const d = o as Partial<ApiSettingsDocument>
  if (d.version !== 1 || !Array.isArray(d.presets)) return null
  const presets = (d.presets as unknown[]).filter((p): p is ApiPreset => {
    if (!p || typeof p !== 'object' || Array.isArray(p)) return false
    const o = p as Partial<ApiPreset>
    return typeof o.id === 'string' && o.id.length > 0
  })
  if (presets.length === 0) return null
  const presetsNorm: ApiPreset[] = presets.map((p) => ({
    ...p,
    linkedPromptPresetId:
      typeof p.linkedPromptPresetId === 'string' &&
      p.linkedPromptPresetId.trim()
        ? p.linkedPromptPresetId.trim()
        : null,
    apiKeyId:
      typeof p.apiKeyId === 'string' && p.apiKeyId.trim()
        ? p.apiKeyId.trim()
        : null,
  }))
  let active =
    typeof d.activePresetId === 'string' ? d.activePresetId : presetsNorm[0].id
  if (!presetsNorm.some((p) => p.id === active)) active = presetsNorm[0].id
  return {
    version: 1,
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : new Date().toISOString(),
    activePresetId: active,
    presets: presetsNorm,
  }
}

export async function readApiSettingsFromFile(): Promise<ApiSettingsDocument | null> {
  try {
    const raw = await readFile(getApiSettingsPath(), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return normalizeDocument(parsed)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

export async function writeApiSettingsToFile(
  data: ApiSettingsDocument,
): Promise<void> {
  await mkdir(getUserDataDir(getCurrentUserId()), { recursive: true })
  await writeFile(getApiSettingsPath(), `${JSON.stringify(data, null, 2)}\n`, 'utf8')
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
