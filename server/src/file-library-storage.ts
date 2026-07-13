import { existsSync } from 'node:fs'
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import { getFilesDir } from './config.js'
import { createKeyedSerialQueue } from './keyed-serial-queue.js'
import { generateShortId, isValidShortId } from './short-id.js'
import { getCurrentUserId } from './user-context.js'

export type FileLibraryKind = 'image' | 'document' | 'audio' | 'video'

export interface FileLibraryMeta {
  schemaVersion: 1
  fileId: string
  kind: FileLibraryKind
  name: string
  mime: string
  size: number
  createdAt: string
  updatedAt: string
  tags: string[]
  /** RAG 状态预留（M4）；M1 可缺省 */
  indexedAt?: string | null
  chunkCount?: number | null
  embeddingModel?: string | null
}

export interface FileLibraryIndexEntry {
  fileId: string
  kind: FileLibraryKind
  name: string
  mime: string
  size: number
  createdAt: string
  updatedAt: string
  tags: string[]
}

interface FileLibraryIndexFile {
  schemaVersion: 1
  generatedAt: string
  entries: FileLibraryIndexEntry[]
}

export interface FileLibraryListItem extends FileLibraryIndexEntry {}

export class FileLibraryError extends Error {
  constructor(
    readonly code:
      | 'file_not_found'
      | 'file_kind_mismatch'
      | 'file_mime_not_allowed'
      | 'file_invalid_id'
      | 'file_name_invalid'
      | 'file_tags_invalid'
      | 'missing_file_field',
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'FileLibraryError'
  }
}

const KIND_MIME_WHITELIST: Record<FileLibraryKind, ReadonlySet<string>> = {
  image: new Set([
    'image/png',
    'image/jpeg',
    'image/jpg',
    'image/webp',
    'image/gif',
  ]),
  document: new Set([
    'text/plain',
    'text/markdown',
    'text/x-markdown',
    'application/pdf',
    'application/json',
  ]),
  audio: new Set([
    'audio/mpeg',
    'audio/mp3',
    'audio/ogg',
    'audio/wav',
    'audio/wave',
    'audio/x-wav',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
  ]),
  video: new Set(['video/mp4', 'video/webm', 'video/ogg', 'video/quicktime']),
}

const EXT_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.aac': 'audio/aac',
  '.m4a': 'audio/mp4',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
}

const fileLibraryQueue = createKeyedSerialQueue()

function filesQueueKey(): string {
  return `files:${getCurrentUserId()}`
}

/** 同用户 files/ 读写串行（index RMW / 创建 / 删除） */
export function runFileLibraryTask<T>(task: () => Promise<T>): Promise<T> {
  return fileLibraryQueue.run(filesQueueKey(), task)
}

function nowIso(): string {
  return new Date().toISOString()
}

function filesIndexPath(): string {
  return path.join(getFilesDir(), 'index.json')
}

function fileDir(fileId: string): string {
  return path.join(getFilesDir(), fileId)
}

function fileMetaPath(fileId: string): string {
  return path.join(fileDir(fileId), 'meta.json')
}

export function fileContentPath(fileId: string): string {
  return path.join(fileDir(fileId), 'content')
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

async function writeBinaryFileAtomic(
  filePath: string,
  buf: Buffer,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, buf)
  try {
    await rename(tmp, filePath)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

function normalizeMime(raw: string): string {
  return raw.trim().toLowerCase().split(';')[0]?.trim() ?? ''
}

function normalizeKind(raw: unknown): FileLibraryKind | null {
  if (raw === 'image' || raw === 'document' || raw === 'audio' || raw === 'video') {
    return raw
  }
  return null
}

function kindForMime(mime: string): FileLibraryKind | null {
  for (const kind of Object.keys(KIND_MIME_WHITELIST) as FileLibraryKind[]) {
    if (KIND_MIME_WHITELIST[kind].has(mime)) return kind
  }
  return null
}

function canonicalizeMime(mime: string): string {
  if (mime === 'image/jpg') return 'image/jpeg'
  if (mime === 'audio/mp3') return 'audio/mpeg'
  if (mime === 'audio/wave' || mime === 'audio/x-wav') return 'audio/wav'
  if (mime === 'text/x-markdown') return 'text/markdown'
  return mime
}

export function resolveUploadMime(
  filename: string | undefined,
  declaredMime: string | undefined,
): string {
  const fromHeader = declaredMime ? normalizeMime(declaredMime) : ''
  if (fromHeader && fromHeader !== 'application/octet-stream') {
    return canonicalizeMime(fromHeader)
  }
  const ext = path.extname(filename ?? '').toLowerCase()
  const fromExt = EXT_MIME[ext]
  if (fromExt) return fromExt
  return fromHeader || 'application/octet-stream'
}

function assertMimeAllowed(kind: FileLibraryKind, mime: string): void {
  const allowed = KIND_MIME_WHITELIST[kind]
  const candidates = new Set([mime])
  if (mime === 'image/jpeg') candidates.add('image/jpg')
  if (mime === 'audio/mpeg') candidates.add('audio/mp3')
  if (mime === 'audio/wav') {
    candidates.add('audio/wave')
    candidates.add('audio/x-wav')
  }
  if (mime === 'text/markdown') candidates.add('text/x-markdown')
  for (const c of candidates) {
    if (allowed.has(c)) return
  }
  throw new FileLibraryError('file_mime_not_allowed')
}

/** 写入校验：非法结构抛错 */
function normalizeTags(raw: unknown): string[] {
  if (raw == null) return []
  if (!Array.isArray(raw)) {
    throw new FileLibraryError('file_tags_invalid')
  }
  const out: string[] = []
  for (const t of raw) {
    if (typeof t !== 'string') throw new FileLibraryError('file_tags_invalid')
    const s = t.trim()
    if (!s) continue
    if (s.length > 64) throw new FileLibraryError('file_tags_invalid')
    out.push(s)
  }
  return [...new Set(out)].slice(0, 32)
}

/** 读盘宽容：脏 tags 降级为空数组 */
function coerceTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const t of raw) {
    if (typeof t !== 'string') continue
    const s = t.trim()
    if (!s || s.length > 64) continue
    out.push(s)
  }
  return [...new Set(out)].slice(0, 32)
}

function normalizeName(raw: unknown, fallback: string): string {
  if (raw == null || raw === '') {
    const f = fallback.trim()
    if (!f) throw new FileLibraryError('file_name_invalid')
    return f.slice(0, 256)
  }
  if (typeof raw !== 'string') throw new FileLibraryError('file_name_invalid')
  const s = raw.trim()
  if (!s) throw new FileLibraryError('file_name_invalid')
  return s.slice(0, 256)
}

function entryFromMeta(meta: FileLibraryMeta): FileLibraryIndexEntry {
  return {
    fileId: meta.fileId,
    kind: meta.kind,
    name: meta.name,
    mime: meta.mime,
    size: meta.size,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    tags: meta.tags,
  }
}

function normalizeIndexEntry(raw: unknown): FileLibraryIndexEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const e = raw as Record<string, unknown>
  const fileId = typeof e.fileId === 'string' ? e.fileId.trim().toLowerCase() : ''
  if (!isValidShortId(fileId)) return null
  const kind = normalizeKind(e.kind)
  if (!kind) return null
  const name = typeof e.name === 'string' ? e.name : fileId
  const mime = typeof e.mime === 'string' ? e.mime : 'application/octet-stream'
  const size = typeof e.size === 'number' && Number.isFinite(e.size) ? e.size : 0
  const createdAt =
    typeof e.createdAt === 'string' ? e.createdAt : new Date(0).toISOString()
  const updatedAt =
    typeof e.updatedAt === 'string' ? e.updatedAt : createdAt
  return {
    fileId,
    kind,
    name,
    mime,
    size,
    createdAt,
    updatedAt,
    tags: coerceTags(e.tags),
  }
}

function emptyIndex(): FileLibraryIndexFile {
  return {
    schemaVersion: 1,
    generatedAt: nowIso(),
    entries: [],
  }
}

async function readIndexFile(): Promise<FileLibraryIndexFile | null> {
  try {
    const raw = JSON.parse(await readFile(filesIndexPath(), 'utf8')) as unknown
    if (
      !raw ||
      typeof raw !== 'object' ||
      (raw as FileLibraryIndexFile).schemaVersion !== 1 ||
      !Array.isArray((raw as FileLibraryIndexFile).entries)
    ) {
      return null
    }
    const entries: FileLibraryIndexEntry[] = []
    for (const ent of (raw as FileLibraryIndexFile).entries) {
      const n = normalizeIndexEntry(ent)
      if (n) entries.push(n)
    }
    return {
      schemaVersion: 1,
      generatedAt:
        typeof (raw as FileLibraryIndexFile).generatedAt === 'string'
          ? (raw as FileLibraryIndexFile).generatedAt
          : nowIso(),
      entries,
    }
  } catch {
    return null
  }
}

async function writeIndexFile(data: FileLibraryIndexFile): Promise<void> {
  data.generatedAt = nowIso()
  await writeJsonFileAtomic(filesIndexPath(), data)
}

async function readMetaFile(fileId: string): Promise<FileLibraryMeta | null> {
  try {
    const raw = JSON.parse(await readFile(fileMetaPath(fileId), 'utf8')) as unknown
    if (!raw || typeof raw !== 'object') return null
    const m = raw as Record<string, unknown>
    if (m.schemaVersion !== 1) return null
    const id =
      typeof m.fileId === 'string' ? m.fileId.trim().toLowerCase() : ''
    if (id !== fileId) return null
    const kind = normalizeKind(m.kind)
    if (!kind) return null
    return {
      schemaVersion: 1,
      fileId: id,
      kind,
      name: typeof m.name === 'string' ? m.name : id,
      mime: typeof m.mime === 'string' ? m.mime : 'application/octet-stream',
      size: typeof m.size === 'number' && Number.isFinite(m.size) ? m.size : 0,
      createdAt:
        typeof m.createdAt === 'string' ? m.createdAt : new Date(0).toISOString(),
      updatedAt:
        typeof m.updatedAt === 'string'
          ? m.updatedAt
          : typeof m.createdAt === 'string'
            ? m.createdAt
            : new Date(0).toISOString(),
      tags: coerceTags(m.tags),
      indexedAt:
        m.indexedAt === null || typeof m.indexedAt === 'string'
          ? (m.indexedAt as string | null)
          : undefined,
      chunkCount:
        typeof m.chunkCount === 'number' || m.chunkCount === null
          ? (m.chunkCount as number | null)
          : undefined,
      embeddingModel:
        m.embeddingModel === null || typeof m.embeddingModel === 'string'
          ? (m.embeddingModel as string | null)
          : undefined,
    }
  } catch {
    return null
  }
}

async function writeMetaFile(meta: FileLibraryMeta): Promise<void> {
  await writeJsonFileAtomic(fileMetaPath(meta.fileId), meta)
}

async function rebuildFileLibraryIndexFromDiskUnsafe(): Promise<FileLibraryIndexFile> {
  await mkdir(getFilesDir(), { recursive: true })
  const names = await readdir(getFilesDir(), { withFileTypes: true })
  const entries: FileLibraryIndexEntry[] = []
  for (const ent of names) {
    if (!ent.isDirectory()) continue
    const id = ent.name.toLowerCase()
    if (!isValidShortId(id)) continue
    const meta = await readMetaFile(id)
    if (!meta) continue
    if (!existsSync(fileContentPath(meta.fileId))) continue
    entries.push(entryFromMeta(meta))
  }
  entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  const file = emptyIndex()
  file.entries = entries
  await writeIndexFile(file)
  return file
}

export async function rebuildFileLibraryIndexFromDisk(): Promise<FileLibraryIndexFile> {
  return runFileLibraryTask(() => rebuildFileLibraryIndexFromDiskUnsafe())
}

async function loadOrRebuildIndexUnsafe(): Promise<FileLibraryIndexFile> {
  const idx = await readIndexFile()
  if (idx) return idx
  return rebuildFileLibraryIndexFromDiskUnsafe()
}

async function upsertIndexEntryUnsafe(meta: FileLibraryMeta): Promise<void> {
  const idx = await loadOrRebuildIndexUnsafe()
  const ent = entryFromMeta(meta)
  const i = idx.entries.findIndex((e) => e.fileId === meta.fileId)
  if (i >= 0) idx.entries[i] = ent
  else idx.entries.unshift(ent)
  await writeIndexFile(idx)
}

async function removeIndexEntryUnsafe(fileId: string): Promise<void> {
  const idx = await loadOrRebuildIndexUnsafe()
  idx.entries = idx.entries.filter((e) => e.fileId !== fileId)
  await writeIndexFile(idx)
}

export async function listFileLibrary(params: {
  offset: number
  limit: number
  search?: string
  kind?: FileLibraryKind | 'all'
}): Promise<{ items: FileLibraryListItem[]; total: number }> {
  return runFileLibraryTask(async () => {
    await mkdir(getFilesDir(), { recursive: true })
    const idx = await loadOrRebuildIndexUnsafe()
    let rows = [...idx.entries]
    const kind = params.kind ?? 'all'
    if (kind !== 'all') {
      rows = rows.filter((r) => r.kind === kind)
    }
    const q = (params.search ?? '').trim().toLowerCase()
    if (q) {
      rows = rows.filter(
        (r) =>
          r.name.toLowerCase().includes(q) ||
          r.mime.toLowerCase().includes(q) ||
          r.fileId.toLowerCase().includes(q) ||
          (r.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      )
    }
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const total = rows.length
    const items = rows.slice(params.offset, params.offset + params.limit)
    return { items, total }
  })
}

export async function getFileLibraryMeta(
  fileId: string,
): Promise<FileLibraryMeta | null> {
  if (!isValidShortId(fileId)) return null
  const id = fileId.trim().toLowerCase()
  const meta = await readMetaFile(id)
  if (!meta) return null
  if (!existsSync(fileContentPath(id))) return null
  return meta
}

export async function createFileLibraryEntry(input: {
  buffer: Buffer
  filename?: string
  mime?: string
  kind?: unknown
  name?: unknown
  tags?: unknown
}): Promise<FileLibraryMeta> {
  return runFileLibraryTask(async () => {
    if (!input.buffer || input.buffer.length === 0) {
      throw new FileLibraryError('missing_file_field')
    }
    const mime = canonicalizeMime(
      resolveUploadMime(input.filename, input.mime),
    )
    const forced = normalizeKind(input.kind)
    const inferred = kindForMime(mime)
    let kind: FileLibraryKind
    if (forced) {
      try {
        assertMimeAllowed(forced, mime)
      } catch {
        throw new FileLibraryError('file_kind_mismatch')
      }
      kind = forced
    } else if (inferred) {
      kind = inferred
    } else {
      throw new FileLibraryError('file_mime_not_allowed')
    }

    const name = normalizeName(
      input.name,
      input.filename?.trim() || `${kind}-${Date.now()}`,
    )
    const tags = normalizeTags(input.tags)

    await mkdir(getFilesDir(), { recursive: true })
    const used = new Set(
      (await loadOrRebuildIndexUnsafe()).entries.map((e) => e.fileId),
    )
    let fileId = generateShortId()
    let created = false
    for (let attempt = 0; attempt < 32; attempt++) {
      while (used.has(fileId)) fileId = generateShortId()
      used.add(fileId)
      try {
        await mkdir(fileDir(fileId), { recursive: false })
        created = true
        break
      } catch (e) {
        const err = e as NodeJS.ErrnoException
        if (err.code === 'EEXIST') {
          fileId = generateShortId()
          continue
        }
        throw e
      }
    }
    if (!created) {
      throw new Error('failed to allocate file id')
    }

    const t = nowIso()
    const meta: FileLibraryMeta = {
      schemaVersion: 1,
      fileId,
      kind,
      name,
      mime,
      size: input.buffer.length,
      createdAt: t,
      updatedAt: t,
      tags,
    }

    try {
      await writeBinaryFileAtomic(fileContentPath(fileId), input.buffer)
      await writeMetaFile(meta)
      await upsertIndexEntryUnsafe(meta)
    } catch (e) {
      await rm(fileDir(fileId), { recursive: true, force: true }).catch(() => {})
      throw e
    }
    return meta
  })
}

export async function patchFileLibraryMeta(
  fileId: string,
  patch: { name?: unknown; tags?: unknown },
): Promise<FileLibraryMeta> {
  return runFileLibraryTask(async () => {
    const meta = await getFileLibraryMeta(fileId)
    if (!meta) throw new FileLibraryError('file_not_found')
    let changed = false
    if (patch.name !== undefined) {
      meta.name = normalizeName(patch.name, meta.name)
      changed = true
    }
    if (patch.tags !== undefined) {
      meta.tags = normalizeTags(patch.tags)
      changed = true
    }
    if (!changed) return meta
    meta.updatedAt = nowIso()
    await writeMetaFile(meta)
    try {
      await upsertIndexEntryUnsafe(meta)
    } catch (e) {
      try {
        await rebuildFileLibraryIndexFromDiskUnsafe()
      } catch {
        throw e
      }
    }
    return meta
  })
}

/**
 * 原地更新二进制：fileId / URL 不变。
 * - 新文件须与现有 **同 kind**（MIME 白名单）
 * - 展示名：显式 `name` > 新上传文件名 > 保留旧名
 */
export async function replaceFileLibraryContent(
  fileId: string,
  input: {
    buffer: Buffer
    filename?: string
    mime?: string
    name?: unknown
    keepName?: boolean
  },
): Promise<FileLibraryMeta> {
  return runFileLibraryTask(async () => {
    const meta = await getFileLibraryMeta(fileId)
    if (!meta) throw new FileLibraryError('file_not_found')
    if (!input.buffer || input.buffer.length === 0) {
      throw new FileLibraryError('missing_file_field')
    }

    const mime = canonicalizeMime(
      resolveUploadMime(input.filename, input.mime),
    )
    try {
      assertMimeAllowed(meta.kind, mime)
    } catch {
      throw new FileLibraryError('file_kind_mismatch')
    }

    if (input.keepName) {
      // keep meta.name
    } else if (input.name !== undefined && input.name !== '') {
      meta.name = normalizeName(input.name, meta.name)
    } else if (input.filename?.trim()) {
      meta.name = normalizeName(input.filename.trim(), meta.name)
    }

    meta.mime = mime
    meta.size = input.buffer.length
    meta.updatedAt = nowIso()
    if (meta.kind === 'document') {
      meta.indexedAt = null
      meta.chunkCount = null
      meta.embeddingModel = null
    }

    await writeBinaryFileAtomic(fileContentPath(meta.fileId), input.buffer)
    await writeMetaFile(meta)
    try {
      await upsertIndexEntryUnsafe(meta)
    } catch (e) {
      try {
        await rebuildFileLibraryIndexFromDiskUnsafe()
      } catch {
        throw e
      }
    }
    return meta
  })
}

export async function deleteFileLibraryEntry(fileId: string): Promise<boolean> {
  return runFileLibraryTask(async () => {
    if (!isValidShortId(fileId)) return false
    const id = fileId.trim().toLowerCase()
    const dir = fileDir(id)
    const existedDir = existsSync(dir)
    if (existedDir) {
      await rm(dir, { recursive: true, force: true })
    }
    const idx = await loadOrRebuildIndexUnsafe()
    const hadEntry = idx.entries.some((e) => e.fileId === id)
    if (hadEntry) {
      try {
        await removeIndexEntryUnsafe(id)
      } catch (e) {
        try {
          await rebuildFileLibraryIndexFromDiskUnsafe()
        } catch {
          throw e
        }
      }
    }
    // 幂等：目录或 index 任一曾存在则视为删除成功（避免幽灵项清理却 404）
    return existedDir || hadEntry
  })
}

/** HTTP content GET：解析 meta + 磁盘路径 */
export async function resolveFileLibraryContent(fileId: string): Promise<{
  contentPath: string
  meta: FileLibraryMeta
  byteSize: number
} | null> {
  const meta = await getFileLibraryMeta(fileId)
  if (!meta) return null
  const contentPath = fileContentPath(meta.fileId)
  try {
    const st = await stat(contentPath)
    if (!st.isFile()) return null
    return { contentPath, meta, byteSize: st.size }
  } catch {
    return null
  }
}
