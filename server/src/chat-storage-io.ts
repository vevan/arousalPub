import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getChatsRoot } from './config.js'
import { normalizeBranchPath } from './chunk-path.js'
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

/**
 * Serialize root conversation index.json mutations per conversationId.
 * Queue is not reentrant — use writeConversationIndexUnsafe inside tasks.
 */
const conversationIndexQueue = createKeyedSerialQueue()

export function runConversationIndexTask<T>(
  conversationId: string,
  task: () => Promise<T>,
): Promise<T> {
  return conversationIndexQueue.run(conversationId, task)
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
  try {
    const raw = await readFile(branchConversationIndexPath(id, bp), 'utf8')
    return JSON.parse(raw) as ConversationIndex
  } catch {
    return null
  }
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
  const filePath = branchConversationIndexPath(id, bp)
  await mkdir(path.dirname(filePath), { recursive: true })
  const normalized = syncConversationCharacterFields(data)
  await writeJsonFileAtomic(filePath, normalized)
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
  const rel = chunkFileName.replace(/\\/g, '/')
  const filePath = path.join(conversationDir(conversationId), rel)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(clean, null, 2), 'utf8')
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
