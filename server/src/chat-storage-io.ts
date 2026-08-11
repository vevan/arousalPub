import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { getChatsRoot } from './config.js'
import {
  normalizeBranchPath,
  splitChunkStoragePath,
} from './chunk-path.js'
import { createKeyedSerialQueue } from './keyed-serial-queue.js'
import { stripTurnForDisk } from './chat-turn-accessors.js'
import type { ChunkFile, ConversationIndex } from './chat-turn-types.js'

function nowIso(): string {
  return new Date().toISOString()
}

/** 解析会话绑定的角色卡 id（顺序即 {{char}}、{{char2}}…） */
export function resolvedCharacterIds(
  idx: Pick<ConversationIndex, 'characterIds'>,
): string[] {
  if (!Array.isArray(idx.characterIds)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of idx.characterIds) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** 解析会话绑定的资料库 id 列表 */
export function resolvedLorebookIds(
  idx: Pick<ConversationIndex, 'lorebookIds'>,
): string[] {
  if (!Array.isArray(idx.lorebookIds)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of idx.lorebookIds) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** 写盘前规范化 characterIds */
export function syncConversationCharacterFields(
  idx: ConversationIndex,
): ConversationIndex {
  const ids = resolvedCharacterIds(idx)
  return {
    ...idx,
    characterIds: ids.length > 0 ? ids : undefined,
  }
}

export function conversationDir(id: string): string {
  return path.join(getChatsRoot(), id)
}

export function conversationIndexPath(id: string): string {
  return path.join(conversationDir(id), 'index.json')
}

/** 分支子目录 index.json（branchPath 为空时会话根） */
export function branchConversationIndexPath(
  id: string,
  branchPath: string,
): string {
  const bp = normalizeBranchPath(branchPath)
  if (!bp) return conversationIndexPath(id)
  return path.join(conversationDir(id), bp, 'index.json')
}

/** 同目录临时文件 + rename，避免并发读到半截 JSON */
async function writeJsonFileAtomic(
  filePath: string,
  data: unknown,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  // Date.now() is not unique within a process.  Concurrent writers to the
  // same target must never share a temporary path (especially on Windows,
  // where opening/removing the other's temp file can fail with EPERM).
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`
  const body = `${JSON.stringify(data, null, 2)}\n`
  await writeFile(tmp, body, 'utf8')
  try {
    await rename(tmp, filePath)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

/**
 * Serialize root conversation index.json mutations per conversationId.
 * Queue is not reentrant — use writeConversationIndexUnsafe inside tasks.
 * Branch indexes use `${conversationId}\0b\0${branchPath}` keys on the same queue.
 */
const conversationIndexQueue = createKeyedSerialQueue()

export function runConversationIndexTask<T>(
  conversationId: string,
  task: () => Promise<T>,
): Promise<T> {
  return conversationIndexQueue.run(conversationId, task)
}

function branchConversationIndexQueueKey(
  conversationId: string,
  branchPath: string,
): string {
  return `${conversationId}\0b\0${normalizeBranchPath(branchPath)}`
}

export function runBranchConversationIndexTask<T>(
  conversationId: string,
  branchPath: string,
  task: () => Promise<T>,
): Promise<T> {
  const bp = normalizeBranchPath(branchPath)
  if (!bp) return runConversationIndexTask(conversationId, task)
  return conversationIndexQueue.run(
    branchConversationIndexQueueKey(conversationId, bp),
    task,
  )
}

export async function readConversationIndex(
  id: string,
): Promise<ConversationIndex | null> {
  const filePath = conversationIndexPath(id)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await readFile(filePath, 'utf8')
      return JSON.parse(raw) as ConversationIndex
    } catch (e) {
      // 并发非原子写盘时可能读到半截 JSON；短延迟后重试一次
      const isParse =
        e instanceof SyntaxError ||
        (e instanceof Error && e.message.includes('JSON'))
      if (isParse && attempt === 0) {
        await new Promise((r) => setTimeout(r, 15))
        continue
      }
      return null
    }
  }
  return null
}

export async function writeConversationIndexUnsafe(
  id: string,
  data: ConversationIndex,
): Promise<void> {
  const dir = conversationDir(id)
  await mkdir(dir, { recursive: true })
  const normalized = syncConversationCharacterFields(data)
  await writeJsonFileAtomic(conversationIndexPath(id), normalized)
}

export async function writeConversationIndex(
  id: string,
  data: ConversationIndex,
): Promise<void> {
  await runConversationIndexTask(id, () => writeConversationIndexUnsafe(id, data))
}

/**
 * Read-modify-write under the per-conversation index lock (re-read on lock).
 * Prefer this over read-outside + writeConversationIndex to avoid lost fields
 * when plugins and chat persist update the same index.
 */
export async function mutateConversationIndex(
  conversationId: string,
  mutator: (
    idx: ConversationIndex,
  ) =>
    | ConversationIndex
    | null
    | Promise<ConversationIndex | null>,
): Promise<ConversationIndex | null> {
  return runConversationIndexTask(conversationId, async () => {
    const idx = await readConversationIndex(conversationId)
    if (!idx) return null
    const next = await mutator(idx)
    if (!next) return null
    await writeConversationIndexUnsafe(conversationId, next)
    return next
  })
}

export async function readBranchConversationIndex(
  id: string,
  branchPath: string,
): Promise<ConversationIndex | null> {
  const bp = normalizeBranchPath(branchPath)
  if (!bp) return readConversationIndex(id)
  const filePath = branchConversationIndexPath(id, bp)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await readFile(filePath, 'utf8')
      return JSON.parse(raw) as ConversationIndex
    } catch (e) {
      const isParse =
        e instanceof SyntaxError ||
        (e instanceof Error && e.message.includes('JSON'))
      if (isParse && attempt === 0) {
        await new Promise((r) => setTimeout(r, 15))
        continue
      }
      return null
    }
  }
  return null
}

async function writeBranchConversationIndexUnsafe(
  id: string,
  branchPath: string,
  data: ConversationIndex,
): Promise<void> {
  const bp = normalizeBranchPath(branchPath)
  const filePath = branchConversationIndexPath(id, bp)
  await mkdir(path.dirname(filePath), { recursive: true })
  const normalized = syncConversationCharacterFields(data)
  await writeJsonFileAtomic(filePath, normalized)
}

export async function writeBranchConversationIndex(
  id: string,
  branchPath: string,
  data: ConversationIndex,
): Promise<void> {
  const bp = normalizeBranchPath(branchPath)
  if (!bp) {
    await writeConversationIndex(id, data)
    return
  }
  await runBranchConversationIndexTask(id, bp, () =>
    writeBranchConversationIndexUnsafe(id, bp, data),
  )
}

/**
 * Read-modify-write under the per-branch index lock (re-read on lock).
 */
export async function mutateBranchConversationIndex(
  conversationId: string,
  branchPath: string,
  mutator: (
    idx: ConversationIndex,
  ) =>
    | ConversationIndex
    | null
    | Promise<ConversationIndex | null>,
): Promise<ConversationIndex | null> {
  const bp = normalizeBranchPath(branchPath)
  if (!bp) return mutateConversationIndex(conversationId, mutator)
  return runBranchConversationIndexTask(conversationId, bp, async () => {
    const idx = await readBranchConversationIndex(conversationId, bp)
    if (!idx) return null
    const next = await mutator(idx)
    if (!next) return null
    await writeBranchConversationIndexUnsafe(conversationId, bp, next)
    return next
  })
}

function resolveChunkFilePath(
  conversationId: string,
  chunkFileName: string,
): string {
  // Containment: only allow normalized branchPath + turn-*.json basenames
  const { branchPath, chunkFileName: base } =
    splitChunkStoragePath(chunkFileName)
  const rel = branchPath ? `${branchPath}/${base}` : base
  const root = path.resolve(conversationDir(conversationId))
  const filePath = path.resolve(root, rel)
  const rootPrefix = root + path.sep
  if (filePath !== root && !filePath.startsWith(rootPrefix)) {
    throw new Error(`invalid chunk path: ${chunkFileName}`)
  }
  return filePath
}

/** Resolve and validate a chunk relative path under the conversation dir. */
export function resolveConversationChunkFilePath(
  conversationId: string,
  chunkFileName: string,
): string {
  return resolveChunkFilePath(conversationId, chunkFileName)
}

export async function writeChunkFile(
  conversationId: string,
  chunkFileName: string,
  chunk: ChunkFile,
): Promise<void> {
  const clean: ChunkFile = {
    ...chunk,
    turns: chunk.turns.map(stripTurnForDisk),
  }
  const filePath = resolveChunkFilePath(conversationId, chunkFileName)
  await writeJsonFileAtomic(filePath, clean)
}

/** 记录本会话远期记忆向量索引所用的 embedding 模型与维度 */
export async function updateConversationMemoryEmbeddingModel(
  conversationId: string,
  embeddingModel: string,
  embeddingDimensions?: number | null,
  hybridFtsProfile?: string | null,
  embeddingProfile?: string | null,
): Promise<ConversationIndex | null> {
  return mutateConversationIndex(conversationId, (idx) => {
    const model = embeddingModel.trim()
    const t = nowIso()
    const dims =
      embeddingDimensions === undefined
        ? idx.memoryEmbeddingDimensions ?? null
        : embeddingDimensions
    const ftsProfile =
      hybridFtsProfile === undefined
        ? idx.memoryHybridFtsProfile ?? null
        : hybridFtsProfile
    const profile =
      embeddingProfile === undefined
        ? idx.memoryEmbeddingProfile ?? null
        : embeddingProfile
    return {
      ...idx,
      updatedAt: t,
      memoryEmbeddingModel: model || null,
      memoryEmbeddingDimensions: dims,
      memoryEmbeddingProfile: profile,
      memoryHybridFtsProfile: ftsProfile,
    }
  })
}
