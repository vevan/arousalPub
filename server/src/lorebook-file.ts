import { existsSync } from 'node:fs'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  LOREBOOK_ID_RE,
  type Lorebook,
  type LorebookEntry,
  type LorebookGroup,
  type LorebookIndexEntry,
  type LorebooksDocument,
  type LorebooksIndexDocument,
} from './lorebook-types.js'
import { getLorebooksDir, getLorebooksIndexPath, getUserDataDir } from './config.js'

export {
  LOREBOOK_ID_RE,
  type Lorebook,
  type LorebookEntry,
  type LorebookGroup,
  type LorebooksDocument,
} from './lorebook-types.js'

function lorebookFilePath(lorebookId: string): string {
  if (!LOREBOOK_ID_RE.test(lorebookId)) {
    throw new Error(`世界书 id 非法: ${lorebookId}`)
  }
  return path.join(getLorebooksDir(), `${lorebookId}.json`)
}

function indexEntryFromLorebook(lb: Record<string, unknown>): LorebookIndexEntry {
  const id = typeof lb.id === 'string' ? lb.id : ''
  const name = typeof lb.name === 'string' ? lb.name : ''
  const updatedAt =
    typeof lb.updatedAt === 'string'
      ? lb.updatedAt
      : typeof lb.createdAt === 'string'
        ? lb.createdAt
        : new Date().toISOString()
  return { id, name, updatedAt }
}

async function readLorebookFile(lorebookId: string): Promise<unknown | null> {
  try {
    const raw = await readFile(lorebookFilePath(lorebookId), 'utf8')
    return JSON.parse(raw) as unknown
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

export function buildDefaultLorebook(): Lorebook {
  const t = new Date().toISOString()
  const mainGroupId = 'group-main'
  return {
    id: 'lore-default',
    name: '默认资料库',
    description: '示例分组与条目结构；可在资料库页编辑。',
    groups: [
      {
        id: mainGroupId,
        name: '主要设定',
        order: 0,
        description: '世界观、规则与常驻背景',
      },
      {
        id: 'group-characters',
        name: '角色',
        order: 1,
      },
      {
        id: 'group-locations',
        name: '地点',
        order: 2,
      },
    ],
    entries: [
      {
        id: 'entry-pub-tone',
        groupId: mainGroupId,
        title: '酒馆基调',
        content:
          'Arousal Pub 坐落于三王国岔路口，灯火昏黄、木梁吱呀。叙事偏慢节奏奇幻，重视气味与触感，避免现代俚语。',
        comment: '种子条目 · 恒定',
        enabled: true,
        order: 0,
        keys: [],
        constant: true,
        priority: 100,
        createdAt: t,
        updatedAt: t,
      },
    ],
    createdAt: t,
    updatedAt: t,
  }
}

/** 索引中所有世界书 id（顺序与 index.json 一致） */
export async function listLorebookIds(): Promise<string[]> {
  const doc = await readLorebooksDocument()
  if (!doc) return []
  return doc.lorebooks.map((lb) => lb.id)
}

export async function readLorebooksDocument(): Promise<LorebooksDocument | null> {
  const indexPath = getLorebooksIndexPath()
  if (!existsSync(indexPath)) return null
  try {
    const raw = await readFile(indexPath, 'utf8')
    const idx = JSON.parse(raw) as Partial<LorebooksIndexDocument>
    if (idx.schemaVersion !== 1 || !Array.isArray(idx.lorebooks)) {
      return null
    }
    const lorebooks: Lorebook[] = []
    for (const entry of idx.lorebooks) {
      if (!entry?.id) continue
      const lb = await readLorebookFile(entry.id)
      if (lb && isLorebookShape(lb)) lorebooks.push(lb)
    }
    if (lorebooks.length === 0) return null
    return {
      schemaVersion: 1,
      savedAt: typeof idx.savedAt === 'string' ? idx.savedAt : '',
      lorebooks,
    }
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

export async function readLorebookById(
  lorebookId: string,
): Promise<Lorebook | null> {
  if (!LOREBOOK_ID_RE.test(lorebookId)) return null
  const raw = await readLorebookFile(lorebookId)
  if (!raw || !isLorebookShape(raw)) return null
  return raw
}

export async function writeLorebooksDocument(
  data: LorebooksDocument,
): Promise<void> {
  const dir = getLorebooksDir()
  await mkdir(dir, { recursive: true })
  await mkdir(getUserDataDir(), { recursive: true })

  const savedAt = data.savedAt || new Date().toISOString()
  const indexEntries: LorebookIndexEntry[] = []
  const keepIds = new Set<string>()

  for (const lb of data.lorebooks) {
    validateLorebookShape(lb)
    const id = lb.id
    keepIds.add(id)
    const body: Lorebook = { ...lb, updatedAt: savedAt }
    await writeFile(
      lorebookFilePath(id),
      `${JSON.stringify(body, null, 2)}\n`,
      'utf8',
    )
    indexEntries.push(indexEntryFromLorebook(body as unknown as Record<string, unknown>))
  }

  const indexDoc: LorebooksIndexDocument = {
    schemaVersion: 1,
    savedAt,
    lorebooks: indexEntries,
  }
  await writeFile(
    getLorebooksIndexPath(),
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

function isLorebookShape(x: unknown): x is Lorebook {
  try {
    validateLorebookShape(x as Lorebook)
    return true
  } catch {
    return false
  }
}

function validateLorebookShape(lb: Lorebook): void {
  if (!lb || typeof lb !== 'object') throw new Error('世界书格式无效')
  if (typeof lb.id !== 'string' || !LOREBOOK_ID_RE.test(lb.id)) {
    throw new Error('世界书缺少合法 id')
  }
  if (typeof lb.name !== 'string' || !lb.name.trim()) {
    throw new Error(`世界书 ${lb.id} 缺少 name`)
  }
  if (!Array.isArray(lb.groups)) throw new Error(`世界书 ${lb.id} 缺少 groups`)
  if (!Array.isArray(lb.entries)) throw new Error(`世界书 ${lb.id} 缺少 entries`)

  const groupIds = new Set<string>()
  for (const g of lb.groups) {
    if (!g || typeof g !== 'object') throw new Error('分组格式无效')
    if (typeof g.id !== 'string' || !g.id.trim()) throw new Error('分组缺少 id')
    if (groupIds.has(g.id)) throw new Error(`分组 id 重复: ${g.id}`)
    groupIds.add(g.id)
    if (typeof g.name !== 'string') throw new Error(`分组 ${g.id} 缺少 name`)
    if (typeof g.order !== 'number' || !Number.isFinite(g.order)) {
      throw new Error(`分组 ${g.id} order 无效`)
    }
  }

  const entryIds = new Set<string>()
  for (const e of lb.entries) {
    validateEntryShape(e, groupIds, entryIds)
  }
}

function validateEntryShape(
  e: LorebookEntry,
  groupIds: Set<string>,
  entryIds: Set<string>,
): void {
  if (!e || typeof e !== 'object') throw new Error('条目格式无效')
  if (typeof e.id !== 'string' || !e.id.trim()) throw new Error('条目缺少 id')
  if (entryIds.has(e.id)) throw new Error(`条目 id 重复: ${e.id}`)
  entryIds.add(e.id)
  if (typeof e.groupId !== 'string' || !groupIds.has(e.groupId)) {
    throw new Error(`条目 ${e.id} 的 groupId 无效`)
  }
  if (typeof e.title !== 'string') throw new Error(`条目 ${e.id} 缺少 title`)
  if (typeof e.content !== 'string') throw new Error(`条目 ${e.id} 缺少 content`)
  if (typeof e.enabled !== 'boolean') throw new Error(`条目 ${e.id} enabled 无效`)
  if (typeof e.order !== 'number' || !Number.isFinite(e.order)) {
    throw new Error(`条目 ${e.id} order 无效`)
  }
  if (!Array.isArray(e.keys)) throw new Error(`条目 ${e.id} keys 须为数组`)
  if (typeof e.constant !== 'boolean') throw new Error(`条目 ${e.id} constant 无效`)
  if (
    e.triggerMode !== undefined &&
    e.triggerMode !== 'keyword' &&
    e.triggerMode !== 'constant' &&
    e.triggerMode !== 'vector'
  ) {
    throw new Error(`条目 ${e.id} triggerMode 无效`)
  }
  if (typeof e.priority !== 'number' || !Number.isFinite(e.priority)) {
    throw new Error(`条目 ${e.id} priority 无效`)
  }
}

export function assertValidLorebooksPayload(body: unknown): {
  lorebooks: Lorebook[]
} {
  if (!body || typeof body !== 'object') {
    throw new Error('请求体须为对象')
  }
  const o = body as { lorebooks?: unknown }
  if (!Array.isArray(o.lorebooks) || o.lorebooks.length === 0) {
    throw new Error('至少保留一本世界书')
  }
  const ids = new Set<string>()
  for (const lb of o.lorebooks) {
    if (!isLorebookShape(lb)) throw new Error('世界书格式无效')
    if (ids.has(lb.id)) throw new Error('世界书 id 重复')
    ids.add(lb.id)
    validateLorebookShape(lb)
  }
  return { lorebooks: o.lorebooks }
}
