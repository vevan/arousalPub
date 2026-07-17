import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  KNOWLEDGE_BASE_ID_RE,
  type KnowledgeBase,
  type KnowledgeBaseIndexEntry,
  type KnowledgeBasesIndexDocument,
  type KnowledgeChunksDocument,
} from './knowledge-base-types.js'
import {
  getKnowledgeBasesDir,
  getKnowledgeBasesIndexPath,
} from './config.js'
import { createKeyedSerialQueue } from './keyed-serial-queue.js'
import { generateShortId } from './short-id.js'
import { getFileLibraryMeta } from './file-library-storage.js'

export {
  KNOWLEDGE_BASE_ID_RE,
  type KnowledgeBase,
  type KnowledgeChunksDocument,
} from './knowledge-base-types.js'

const kbFileQueue = createKeyedSerialQueue()
const KB_FILES_KEY = 'knowledgeBases'

export function runKnowledgeBaseFileTask<T>(
  task: () => Promise<T>,
): Promise<T> {
  return kbFileQueue.run(KB_FILES_KEY, task)
}

async function writeJsonFileAtomic(
  filePath: string,
  data: unknown,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const body = `${JSON.stringify(data, null, 2)}\n`
  await writeFile(tmp, body, 'utf8')
  try {
    await rename(tmp, filePath)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

function kbFilePath(kbId: string): string {
  if (!KNOWLEDGE_BASE_ID_RE.test(kbId)) {
    throw new Error(`知识库 id 非法: ${kbId}`)
  }
  return path.join(getKnowledgeBasesDir(), `${kbId}.json`)
}

function chunksFilePath(kbId: string): string {
  if (!KNOWLEDGE_BASE_ID_RE.test(kbId)) {
    throw new Error(`知识库 id 非法: ${kbId}`)
  }
  return path.join(getKnowledgeBasesDir(), kbId, 'chunks.json')
}

function indexEntryFromKb(kb: KnowledgeBase): KnowledgeBaseIndexEntry {
  return { id: kb.id, name: kb.name, updatedAt: kb.updatedAt }
}

function normalizeFileIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of raw) {
    if (typeof item !== 'string') continue
    const id = item.trim().toLowerCase()
    if (!/^[0-9a-f]{8}$/.test(id) || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

const FILE_ID_RE = /^[0-9a-f]{8}$/

/** 稀疏别名表：仅保留合法 fileId + 非空别名 */
function normalizeFileAliases(
  raw: unknown,
): Record<string, string> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const id = k.trim().toLowerCase()
    if (!FILE_ID_RE.test(id) || typeof v !== 'string') continue
    const alias = v.trim()
    if (!alias) continue
    out[id] = alias
  }
  return Object.keys(out).length ? out : undefined
}

function normalizeKnowledgeBase(raw: unknown): KnowledgeBase | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const id = typeof o.id === 'string' ? o.id.trim() : ''
  if (!KNOWLEDGE_BASE_ID_RE.test(id)) return null
  const name =
    typeof o.name === 'string' && o.name.trim() ? o.name.trim() : id
  const t =
    typeof o.updatedAt === 'string'
      ? o.updatedAt
      : typeof o.createdAt === 'string'
        ? o.createdAt
        : new Date().toISOString()
  const createdAt = typeof o.createdAt === 'string' ? o.createdAt : t
  const kb: KnowledgeBase = {
    id,
    name,
    fileIds: normalizeFileIds(o.fileIds),
    createdAt,
    updatedAt: t,
  }
  if (typeof o.description === 'string' && o.description.trim()) {
    kb.description = o.description.trim()
  }
  const aliases = normalizeFileAliases(o.fileAliases)
  if (aliases) kb.fileAliases = aliases
  if (
    o.indexStatus === 'idle' ||
    o.indexStatus === 'indexing' ||
    o.indexStatus === 'ready' ||
    o.indexStatus === 'error'
  ) {
    kb.indexStatus = o.indexStatus
  }
  if (typeof o.indexedAt === 'string') kb.indexedAt = o.indexedAt
  if (typeof o.chunkCount === 'number' && Number.isFinite(o.chunkCount)) {
    kb.chunkCount = Math.max(0, Math.floor(o.chunkCount))
  }
  if (typeof o.indexError === 'string') kb.indexError = o.indexError
  return kb
}

async function readKbFile(kbId: string): Promise<KnowledgeBase | null> {
  try {
    const raw = await readFile(kbFilePath(kbId), 'utf8')
    return normalizeKnowledgeBase(JSON.parse(raw) as unknown)
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

async function readIndexUnsafe(): Promise<KnowledgeBasesIndexDocument> {
  try {
    const raw = await readFile(getKnowledgeBasesIndexPath(), 'utf8')
    const parsed = JSON.parse(raw) as KnowledgeBasesIndexDocument
    if (
      !parsed ||
      parsed.schemaVersion !== 1 ||
      !Array.isArray(parsed.knowledgeBases)
    ) {
      return { schemaVersion: 1, savedAt: new Date().toISOString(), knowledgeBases: [] }
    }
    return parsed
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') {
      return {
        schemaVersion: 1,
        savedAt: new Date().toISOString(),
        knowledgeBases: [],
      }
    }
    throw e
  }
}

async function writeIndexUnsafe(
  entries: KnowledgeBaseIndexEntry[],
): Promise<void> {
  const doc: KnowledgeBasesIndexDocument = {
    schemaVersion: 1,
    savedAt: new Date().toISOString(),
    knowledgeBases: entries,
  }
  await writeJsonFileAtomic(getKnowledgeBasesIndexPath(), doc)
}

async function upsertIndexEntryUnsafe(kb: KnowledgeBase): Promise<void> {
  const idx = await readIndexUnsafe()
  const entry = indexEntryFromKb(kb)
  const i = idx.knowledgeBases.findIndex((e) => e.id === kb.id)
  if (i >= 0) idx.knowledgeBases[i] = entry
  else idx.knowledgeBases.push(entry)
  idx.knowledgeBases.sort((a, b) => a.name.localeCompare(b.name, 'en'))
  await writeIndexUnsafe(idx.knowledgeBases)
}

async function removeIndexEntryUnsafe(kbId: string): Promise<void> {
  const idx = await readIndexUnsafe()
  await writeIndexUnsafe(idx.knowledgeBases.filter((e) => e.id !== kbId))
}

export async function readKnowledgeBasesIndexSummary(): Promise<KnowledgeBasesIndexDocument> {
  return runKnowledgeBaseFileTask(() => readIndexUnsafe())
}

export async function readKnowledgeBaseById(
  kbId: string,
): Promise<KnowledgeBase | null> {
  if (!KNOWLEDGE_BASE_ID_RE.test(kbId)) return null
  return runKnowledgeBaseFileTask(() => readKbFile(kbId))
}

export async function readKnowledgeBasesByIds(
  ids: string[],
): Promise<KnowledgeBase[]> {
  const out: KnowledgeBase[] = []
  for (const id of ids) {
    const kb = await readKnowledgeBaseById(id)
    if (kb) out.push(kb)
  }
  return out
}

/** 校验对话绑定用 id 均存在；返回去重有序列表或首个缺失 id */
export async function validateKnowledgeBaseIds(
  rawIds: string[],
): Promise<
  | { ok: true; ids: string[] }
  | { ok: false; missingId: string }
> {
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of rawIds) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    if (!KNOWLEDGE_BASE_ID_RE.test(id)) {
      return { ok: false, missingId: id }
    }
    seen.add(id)
    cleaned.push(id)
  }
  for (const id of cleaned) {
    const kb = await readKnowledgeBaseById(id)
    if (!kb) return { ok: false, missingId: id }
  }
  return { ok: true, ids: cleaned }
}

export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const idx = await readKnowledgeBasesIndexSummary()
  const out: KnowledgeBase[] = []
  for (const e of idx.knowledgeBases) {
    const kb = await readKnowledgeBaseById(e.id)
    if (kb) out.push(kb)
  }
  return out
}

/** 校验 fileIds 均为 document；返回规范化列表 */
export async function assertDocumentFileIds(
  fileIds: string[],
): Promise<string[]> {
  const cleaned = normalizeFileIds(fileIds)
  for (const fid of cleaned) {
    const meta = await getFileLibraryMeta(fid)
    if (!meta) {
      const err = new Error('file_not_found') as Error & { code: string; fileId: string }
      err.code = 'file_not_found'
      err.fileId = fid
      throw err
    }
    if (meta.kind !== 'document') {
      const err = new Error('file_not_document') as Error & {
        code: string
        fileId: string
      }
      err.code = 'file_not_document'
      err.fileId = fid
      throw err
    }
  }
  return cleaned
}

export async function createKnowledgeBase(params: {
  name: string
  description?: string
  fileIds?: string[]
  id?: string
}): Promise<KnowledgeBase> {
  const name = params.name.trim()
  if (!name) {
    const err = new Error('name_required') as Error & { code: string }
    err.code = 'name_required'
    throw err
  }
  const fileIds = await assertDocumentFileIds(params.fileIds ?? [])
  return runKnowledgeBaseFileTask(async () => {
    let id =
      typeof params.id === 'string' && params.id.trim()
        ? params.id.trim()
        : `kb-${generateShortId()}`
    if (!KNOWLEDGE_BASE_ID_RE.test(id)) {
      const err = new Error('invalid_id') as Error & { code: string }
      err.code = 'invalid_id'
      throw err
    }
    if (await readKbFile(id)) {
      const err = new Error('kb_id_taken') as Error & { code: string }
      err.code = 'kb_id_taken'
      throw err
    }
    const t = new Date().toISOString()
    const kb: KnowledgeBase = {
      id,
      name,
      fileIds,
      createdAt: t,
      updatedAt: t,
      indexStatus: 'idle',
      chunkCount: 0,
    }
    if (params.description?.trim()) kb.description = params.description.trim()
    await writeJsonFileAtomic(kbFilePath(id), kb)
    await upsertIndexEntryUnsafe(kb)
    return kb
  })
}

export async function writeKnowledgeBase(kb: KnowledgeBase): Promise<void> {
  await runKnowledgeBaseFileTask(async () => {
    await writeJsonFileAtomic(kbFilePath(kb.id), kb)
    await upsertIndexEntryUnsafe(kb)
  })
}

export type KnowledgeBaseIndexFieldsPatch = {
  indexStatus: NonNullable<KnowledgeBase['indexStatus']>
  indexedAt?: string
  chunkCount?: number
  indexError?: string
  clearIndexError?: boolean
}

/**
 * 在 KB 文件队列内 RMW 只改索引字段，避免与并发改名/改描述互相覆盖。
 * 库不存在返回 null；成功返回更新后的完整 KB。
 */
export async function updateKnowledgeBaseIndexFields(
  kbId: string,
  patch: KnowledgeBaseIndexFieldsPatch,
): Promise<KnowledgeBase | null> {
  if (!KNOWLEDGE_BASE_ID_RE.test(kbId)) return null
  return runKnowledgeBaseFileTask(async () => {
    const cur = await readKbFile(kbId)
    if (!cur) return null
    const next: KnowledgeBase = {
      ...cur,
      indexStatus: patch.indexStatus,
      updatedAt: new Date().toISOString(),
    }
    if (patch.indexedAt !== undefined) next.indexedAt = patch.indexedAt
    if (patch.chunkCount !== undefined) next.chunkCount = patch.chunkCount
    if (patch.clearIndexError) delete next.indexError
    else if (patch.indexError !== undefined) next.indexError = patch.indexError
    await writeJsonFileAtomic(kbFilePath(kbId), next)
    await upsertIndexEntryUnsafe(next)
    return next
  })
}

export async function patchKnowledgeBase(
  kbId: string,
  patch: {
    name?: string
    description?: string | null
    fileIds?: string[]
    /** fileId → 别名；空串/空白视为删除该别名 */
    fileAliases?: Record<string, string>
  },
): Promise<KnowledgeBase | null> {
  if (patch.fileIds) await assertDocumentFileIds(patch.fileIds)
  return runKnowledgeBaseFileTask(async () => {
    const cur = await readKbFile(kbId)
    if (!cur) return null
    const next: KnowledgeBase = { ...cur, updatedAt: new Date().toISOString() }
    if (typeof patch.name === 'string' && patch.name.trim()) {
      next.name = patch.name.trim()
    }
    if (patch.description === null) delete next.description
    else if (typeof patch.description === 'string') {
      const d = patch.description.trim()
      if (d) next.description = d
      else delete next.description
    }
    if (patch.fileIds) {
      next.fileIds = normalizeFileIds(patch.fileIds)
      if (next.fileAliases) {
        const validIds = new Set(next.fileIds)
        const pruned = Object.fromEntries(
          Object.entries(next.fileAliases).filter(([id]) => validIds.has(id)),
        )
        if (Object.keys(pruned).length) next.fileAliases = pruned
        else delete next.fileAliases
      }
    }
    if (patch.fileAliases) {
      const merged: Record<string, string> = { ...(next.fileAliases ?? {}) }
      for (const [k, v] of Object.entries(patch.fileAliases)) {
        const id = k.trim().toLowerCase()
        if (!FILE_ID_RE.test(id)) continue
        const alias = v.trim()
        if (alias) merged[id] = alias
        else delete merged[id]
      }
      // 清理不在 fileIds 内的残留别名
      const validIds = new Set(next.fileIds)
      for (const id of Object.keys(merged)) {
        if (!validIds.has(id)) delete merged[id]
      }
      if (Object.keys(merged).length) next.fileAliases = merged
      else delete next.fileAliases
    }
    await writeJsonFileAtomic(kbFilePath(kbId), next)
    await upsertIndexEntryUnsafe(next)
    return next
  })
}

/** 仅清派生切片目录（kb 文件已不存在时清理写入竞态残留） */
export async function removeKnowledgeBaseDerivedFiles(
  kbId: string,
): Promise<void> {
  if (!KNOWLEDGE_BASE_ID_RE.test(kbId)) return
  await runKnowledgeBaseFileTask(async () => {
    await rm(path.join(getKnowledgeBasesDir(), kbId), {
      recursive: true,
      force: true,
    })
  })
}

export async function deleteKnowledgeBase(kbId: string): Promise<boolean> {
  if (!KNOWLEDGE_BASE_ID_RE.test(kbId)) return false
  return runKnowledgeBaseFileTask(async () => {
    const cur = await readKbFile(kbId)
    if (!cur) return false
    await rm(kbFilePath(kbId), { force: true })
    await rm(path.join(getKnowledgeBasesDir(), kbId), {
      recursive: true,
      force: true,
    })
    await removeIndexEntryUnsafe(kbId)
    return true
  })
}

/** 从所有知识库摘除 fileId；返回受影响的 kbId 列表 */
export async function removeFileIdFromAllKnowledgeBases(
  fileId: string,
): Promise<string[]> {
  const id = fileId.trim().toLowerCase()
  if (!/^[0-9a-f]{8}$/.test(id)) return []
  return runKnowledgeBaseFileTask(async () => {
    const idx = await readIndexUnsafe()
    const affected: string[] = []
    for (const e of idx.knowledgeBases) {
      const kb = await readKbFile(e.id)
      if (!kb || !kb.fileIds.includes(id)) continue
      const next: KnowledgeBase = {
        ...kb,
        fileIds: kb.fileIds.filter((f) => f !== id),
        updatedAt: new Date().toISOString(),
        indexStatus: 'idle',
      }
      if (next.fileAliases && id in next.fileAliases) {
        const { [id]: _removed, ...rest } = next.fileAliases
        if (Object.keys(rest).length) next.fileAliases = rest
        else delete next.fileAliases
      }
      await writeJsonFileAtomic(kbFilePath(kb.id), next)
      await upsertIndexEntryUnsafe(next)
      affected.push(kb.id)
    }
    return affected
  })
}

export async function findKnowledgeBasesContainingFile(
  fileId: string,
): Promise<KnowledgeBase[]> {
  const id = fileId.trim().toLowerCase()
  if (!/^[0-9a-f]{8}$/.test(id)) return []
  const all = await listKnowledgeBases()
  return all.filter((kb) => kb.fileIds.includes(id))
}

export async function readKnowledgeChunksDocument(
  kbId: string,
): Promise<KnowledgeChunksDocument | null> {
  try {
    const raw = await readFile(chunksFilePath(kbId), 'utf8')
    return JSON.parse(raw) as KnowledgeChunksDocument
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return null
    throw e
  }
}

export async function writeKnowledgeChunksDocument(
  doc: KnowledgeChunksDocument,
): Promise<void> {
  await writeJsonFileAtomic(chunksFilePath(doc.kbId), doc)
}
