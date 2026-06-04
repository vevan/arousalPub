import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getPromptsDir, getPromptsIndexPath, getUserDataDir } from './config.js'
import { getCurrentUserId } from './user-context.js'

export const PROMPT_PRESET_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/
const PRESET_ID_RE = PROMPT_PRESET_ID_RE

export function isValidPromptPresetId(id: string): boolean {
  return PRESET_ID_RE.test(id)
}

export interface PromptPresetIndexEntry {
  id: string
  name: string
  updatedAt: string
}

export interface PromptsIndexDocument {
  version: 3
  savedAt: string
  activePresetId: string
  presets: PromptPresetIndexEntry[]
}

/** GET/PUT API 与前端 PersistedState 对齐的聚合文档 */
export interface PromptsDocument {
  version: 3
  savedAt: string
  activePresetId: string
  presets: unknown[]
}

function presetFilePath(presetId: string, userId?: string): string {
  if (!PRESET_ID_RE.test(presetId)) {
    throw new Error(`预设 id 非法: ${presetId}`)
  }
  return path.join(getPromptsDir(userId), `${presetId}.json`)
}

function indexEntryFromPreset(p: Record<string, unknown>): PromptPresetIndexEntry {
  const id = typeof p.id === 'string' ? p.id : ''
  const name = typeof p.name === 'string' ? p.name : ''
  const updatedAt =
    typeof p.updatedAt === 'string'
      ? p.updatedAt
      : typeof p.createdAt === 'string'
        ? p.createdAt
        : new Date().toISOString()
  return { id, name, updatedAt }
}

async function readPresetFile(presetId: string): Promise<unknown | null> {
  try {
    const raw = await readFile(presetFilePath(presetId), 'utf8')
    return JSON.parse(raw) as unknown
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

export async function readPromptsIndexDocument(): Promise<PromptsIndexDocument | null> {
  const indexPath = getPromptsIndexPath()
  if (!existsSync(indexPath)) return null
  try {
    const raw = await readFile(indexPath, 'utf8')
    const idx = JSON.parse(raw) as Partial<PromptsIndexDocument>
    if (!Array.isArray(idx.presets) || typeof idx.activePresetId !== 'string') {
      return null
    }
    const presets = idx.presets
      .filter(
        (e): e is PromptPresetIndexEntry =>
          !!e &&
          typeof e.id === 'string' &&
          isValidPromptPresetId(e.id) &&
          typeof e.name === 'string',
      )
      .map((e) => ({
        id: e.id,
        name: e.name,
        updatedAt:
          typeof e.updatedAt === 'string'
            ? e.updatedAt
            : new Date().toISOString(),
      }))
    if (presets.length === 0) return null
    let active = idx.activePresetId
    if (!presets.some((p) => p.id === active)) active = presets[0].id
    return {
      version: 3,
      savedAt: typeof idx.savedAt === 'string' ? idx.savedAt : '',
      activePresetId: active,
      presets,
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

export async function readPromptPresetById(
  presetId: string,
): Promise<unknown | null> {
  if (!isValidPromptPresetId(presetId)) {
    throw new Error(`预设 id 非法: ${presetId}`)
  }
  return readPresetFile(presetId)
}

async function writeIndexDocument(indexDoc: PromptsIndexDocument): Promise<void> {
  await mkdir(getPromptsDir(), { recursive: true })
  await mkdir(getUserDataDir(getCurrentUserId()), { recursive: true })
  await writeFile(
    getPromptsIndexPath(),
    `${JSON.stringify(indexDoc, null, 2)}\n`,
    'utf8',
  )
}

export async function writePromptPreset(preset: unknown): Promise<string> {
  if (!preset || typeof preset !== 'object' || Array.isArray(preset)) {
    throw new Error('预设格式无效')
  }
  const po = preset as Record<string, unknown>
  const id = typeof po.id === 'string' ? po.id : ''
  if (!id || !isValidPromptPresetId(id)) {
    throw new Error('预设缺少合法 id')
  }
  if (!Array.isArray(po.groups)) throw new Error('预设缺少 groups 数组')
  if (!Array.isArray(po.prompts)) throw new Error('预设缺少 prompts 数组')

  const savedAt = new Date().toISOString()
  const body = { ...po, id, updatedAt: savedAt }
  await writeFile(
    presetFilePath(id),
    `${JSON.stringify(body, null, 2)}\n`,
    'utf8',
  )

  const index = (await readPromptsIndexDocument()) ?? {
    version: 3 as const,
    savedAt,
    activePresetId: id,
    presets: [],
  }
  const entry = indexEntryFromPreset(body)
  const presets = index.presets.filter((p) => p.id !== id)
  presets.push(entry)
  let active = index.activePresetId
  if (!presets.some((p) => p.id === active)) active = presets[0]?.id ?? id
  await writeIndexDocument({
    version: 3,
    savedAt,
    activePresetId: active,
    presets,
  })
  return savedAt
}

export async function patchPromptsIndex(patch: {
  activePresetId?: string
  presets?: PromptPresetIndexEntry[]
}): Promise<string> {
  const index = await readPromptsIndexDocument()
  if (!index) throw new Error('提示词索引不存在')
  const savedAt = new Date().toISOString()
  let presets = index.presets
  if (patch.presets) {
    if (patch.presets.length === 0) throw new Error('至少保留一条预设')
    presets = patch.presets
  }
  let active =
    typeof patch.activePresetId === 'string'
      ? patch.activePresetId
      : index.activePresetId
  if (!presets.some((p) => p.id === active)) active = presets[0].id
  await writeIndexDocument({
    version: 3,
    savedAt,
    activePresetId: active,
    presets,
  })
  return savedAt
}

export async function deletePromptPreset(presetId: string): Promise<void> {
  if (!isValidPromptPresetId(presetId)) {
    throw new Error(`预设 id 非法: ${presetId}`)
  }
  const index = await readPromptsIndexDocument()
  if (!index) throw new Error('提示词索引不存在')
  if (index.presets.length <= 1) throw new Error('至少保留一条预设')
  const presets = index.presets.filter((p) => p.id !== presetId)
  let active = index.activePresetId
  if (active === presetId) active = presets[0].id
  const savedAt = new Date().toISOString()
  await writeIndexDocument({
    version: 3,
    savedAt,
    activePresetId: active,
    presets,
  })
  await rm(presetFilePath(presetId), { force: true })
}

export function assertValidPromptPresetBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('预设格式无效')
  }
  const pp = body as Record<string, unknown>
  if (typeof pp.id !== 'string' || !pp.id) throw new Error('预设缺少 id')
  if (!PRESET_ID_RE.test(pp.id)) throw new Error(`预设 id 非法: ${pp.id}`)
  if (!Array.isArray(pp.groups)) throw new Error('预设缺少 groups 数组')
  if (!Array.isArray(pp.prompts)) throw new Error('预设缺少 prompts 数组')
  return pp
}

export async function readPromptsDocument(): Promise<PromptsDocument | null> {
  const index = await readPromptsIndexDocument()
  if (!index) return null
  try {
    const idx = index
    if (!Array.isArray(idx.presets) || typeof idx.activePresetId !== 'string') {
      return null
    }
    const presets: unknown[] = []
    for (const entry of idx.presets) {
      if (!entry?.id) continue
      const p = await readPresetFile(entry.id)
      if (p) presets.push(p)
    }
    if (presets.length === 0) return null
    return {
      version: 3,
      savedAt: typeof idx.savedAt === 'string' ? idx.savedAt : '',
      activePresetId: idx.activePresetId,
      presets,
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

export async function writePromptsDocumentForUser(
  userId: string,
  data: PromptsDocument,
): Promise<void> {
  const dir = getPromptsDir(userId)
  await mkdir(dir, { recursive: true })
  await mkdir(getUserDataDir(userId), { recursive: true })

  const savedAt = data.savedAt || new Date().toISOString()
  const indexEntries: PromptPresetIndexEntry[] = []
  const keepIds = new Set<string>()

  for (const p of data.presets) {
    if (!p || typeof p !== 'object') continue
    const po = p as Record<string, unknown>
    const id = typeof po.id === 'string' ? po.id : ''
    if (!id || !PRESET_ID_RE.test(id)) {
      throw new Error('预设缺少合法 id')
    }
    keepIds.add(id)
    const body = { ...po, id, updatedAt: savedAt }
    await writeFile(
      presetFilePath(id, userId),
      `${JSON.stringify(body, null, 2)}\n`,
      'utf8',
    )
    indexEntries.push(indexEntryFromPreset(body))
  }

  const indexDoc: PromptsIndexDocument = {
    version: 3,
    savedAt,
    activePresetId: data.activePresetId,
    presets: indexEntries,
  }
  await writeFile(
    getPromptsIndexPath(userId),
    `${JSON.stringify(indexDoc, null, 2)}\n`,
    'utf8',
  )

  const names = await readdir(dir).catch(() => [] as string[])
  for (const name of names) {
    if (!name.endsWith('.json') || name === 'index.json') continue
    const id = name.slice(0, -5)
    if (!keepIds.has(id)) {
      await rm(path.join(dir, name), { force: true })
    }
  }
}

export async function writePromptsDocument(data: PromptsDocument): Promise<void> {
  return writePromptsDocumentForUser(getCurrentUserId(), data)
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
    if (!PRESET_ID_RE.test(pp.id)) throw new Error(`预设 id 非法: ${pp.id}`)
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
