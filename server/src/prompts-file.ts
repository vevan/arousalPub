import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { DATA_DIR, PROMPTS_PATH } from './config.js'

export { PROMPTS_PATH }

/**
 * 文档结构与前端 PersistedState 对齐。这里只做薄壳校验：
 * 不细究每条 entry 的字段，让前端类型作为唯一真值，避免双向 schema 漂移。
 */
export interface PromptsDocument {
  version: 2
  savedAt: string
  activePresetId: string
  presets: unknown[]
}

export async function readPromptsDocument(): Promise<PromptsDocument | null> {
  try {
    const raw = await readFile(PROMPTS_PATH, 'utf8')
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as Partial<PromptsDocument>
    if (!Array.isArray(obj.presets)) return null
    if (typeof obj.activePresetId !== 'string') return null
    return {
      version: 2,
      savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : '',
      activePresetId: obj.activePresetId,
      presets: obj.presets,
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

export async function writePromptsDocument(
  data: PromptsDocument,
): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true })
  await writeFile(PROMPTS_PATH, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
}

export function assertValidPromptsPayload(body: unknown): {
  activePresetId: string
  presets: unknown[]
} {
  if (!body || typeof body !== 'object') {
    throw new Error('请求体须为对象')
  }
  const o = body as { activePresetId?: unknown; presets?: unknown }
  if (!Array.isArray(o.presets) || o.presets.length === 0) {
    throw new Error('至少保留一个预设')
  }
  if (typeof o.activePresetId !== 'string' || !o.activePresetId) {
    throw new Error('activePresetId 缺失')
  }
  const ids = new Set<string>()
  for (const p of o.presets) {
    if (!p || typeof p !== 'object') throw new Error('预设格式无效')
    const pp = p as { id?: unknown; groups?: unknown; prompts?: unknown }
    if (typeof pp.id !== 'string' || !pp.id) throw new Error('预设缺少 id')
    if (ids.has(pp.id)) throw new Error('预设 id 重复')
    ids.add(pp.id)
    if (!Array.isArray(pp.groups)) throw new Error('预设缺少 groups 数组')
    if (!Array.isArray(pp.prompts)) throw new Error('预设缺少 prompts 数组')
  }
  if (!ids.has(o.activePresetId)) {
    throw new Error('activePresetId 与 presets 不匹配')
  }
  return { activePresetId: o.activePresetId, presets: o.presets }
}
