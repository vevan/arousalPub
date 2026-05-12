import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
  /** 是否在界面展示思维链（仅前端） */
  showReasoningChain: boolean
  /** 是否在请求体中请求思维链（合并进上游 body，可被自定义参数覆盖） */
  requestReasoningChain: boolean
}

export interface ApiSettingsDocument {
  version: 1
  savedAt: string
  activePresetId: string
  presets: ApiPreset[]
}

/** @deprecated 旧版单条扁平结构，读取时自动迁移 */
interface LegacyFlatFile {
  savedAt?: string
  alias?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  contextLength?: number | null
  maxTokens?: number | null
  stream?: boolean
  temperature?: number | null
  topP?: number | null
  topK?: number | null
  dry?: number | null
  frequencyPenalty?: number | null
  presencePenalty?: number | null
  customParamsJson?: string
  showReasoningChain?: boolean
  requestReasoningChain?: boolean
}

const dataDir = path.join(__dirname, '..', 'data')
export const API_SETTINGS_PATH = path.join(dataDir, 'api-settings.json')

function presetFromLegacy(o: LegacyFlatFile, id: string): ApiPreset {
  return {
    id,
    alias: typeof o.alias === 'string' ? o.alias : '',
    baseUrl:
      typeof o.baseUrl === 'string' ? o.baseUrl : 'https://api.openai.com/v1',
    apiKey: typeof o.apiKey === 'string' ? o.apiKey : '',
    model: typeof o.model === 'string' ? o.model : 'gpt-4o-mini',
    contextLength: o.contextLength ?? null,
    maxTokens: o.maxTokens ?? null,
    stream: Boolean(o.stream),
    temperature: o.temperature ?? null,
    topP: o.topP ?? null,
    topK: o.topK ?? null,
    dry: o.dry ?? null,
    frequencyPenalty: o.frequencyPenalty ?? null,
    presencePenalty: o.presencePenalty ?? null,
    customParamsJson:
      typeof o.customParamsJson === 'string' ? o.customParamsJson : '',
    showReasoningChain:
      typeof o.showReasoningChain === 'boolean' ? o.showReasoningChain : true,
    requestReasoningChain:
      typeof o.requestReasoningChain === 'boolean'
        ? o.requestReasoningChain
        : false,
  }
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
  let active =
    typeof d.activePresetId === 'string' ? d.activePresetId : presets[0].id
  if (!presets.some((p) => p.id === active)) active = presets[0].id
  return {
    version: 1,
    savedAt: typeof d.savedAt === 'string' ? d.savedAt : new Date().toISOString(),
    activePresetId: active,
    presets,
  }
}

function migrateLegacyFlat(o: unknown): ApiSettingsDocument | null {
  if (!o || typeof o !== 'object') return null
  const flat = o as LegacyFlatFile
  if ('presets' in flat && Array.isArray((flat as ApiSettingsDocument).presets)) {
    return null
  }
  const keys = flat as Record<string, unknown>
  if (!('baseUrl' in keys) && !('model' in keys)) {
    return null
  }
  const id = randomUUID()
  const preset = presetFromLegacy(flat, id)
  return {
    version: 1,
    savedAt:
      typeof flat.savedAt === 'string' ? flat.savedAt : new Date().toISOString(),
    activePresetId: id,
    presets: [preset],
  }
}

export async function readApiSettingsFromFile(): Promise<ApiSettingsDocument | null> {
  try {
    const raw = await readFile(API_SETTINGS_PATH, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return (
      normalizeDocument(parsed) ??
      migrateLegacyFlat(parsed)
    )
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

export async function writeApiSettingsToFile(
  data: ApiSettingsDocument,
): Promise<void> {
  await mkdir(dataDir, { recursive: true })
  await writeFile(API_SETTINGS_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
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
    throw new Error('至少保留一条预设')
  }
  const ids = new Set<string>()
  for (const p of presets) {
    if (!p || typeof p !== 'object') throw new Error('预设格式无效')
    if (typeof p.id !== 'string' || !p.id) throw new Error('预设缺少 id')
    if (ids.has(p.id)) throw new Error('预设 id 重复')
    ids.add(p.id)
    assertValidCustomParamsJson(
      typeof p.customParamsJson === 'string' ? p.customParamsJson : '',
    )
  }
}
