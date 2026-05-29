import {
  createEmbedding,
  createEmbeddingWithCredentials,
} from './embedding-client.js'
import type { ResolvedEmbeddingCredentials } from './embedding-credential-resolve.js'
import { readLorebookById } from './lorebook-file.js'
import type { Lorebook } from './lorebook-types.js'
import {
  lorebookEntryEmbeddingCorpus,
  resolveEntryTriggerMode,
} from './lorebook-entry-utils.js'
import {
  deleteLorebookVectorIndex,
  replaceLorebookVectorIndex,
  type LoreEntryVectorRow,
} from './lorebook-vector-store.js'

export interface LorebookVectorReindexStats {
  lorebooksReindexed: number
  lorebookEntriesIndexed: number
}

export interface LorebookVectorReindexError {
  error: string
  detail?: string
  lorebookId?: string
}

/** 保存资料库后异步重建向量索引（仅 vector 触发且启用的条目） */
export function scheduleLorebookVectorReindex(lorebooks: Lorebook[]): void {
  void reindexLorebooksVector(lorebooks).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[lorebook-vector-index] reindex failed:', e)
  })
}

export async function reindexLorebooksVector(
  lorebooks: Lorebook[],
): Promise<void> {
  for (const lb of lorebooks) {
    await reindexOneLorebookVector(lb)
  }
}

function uniqueLorebookIds(ids: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of ids) {
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

function vectorEntriesOf(lb: Lorebook) {
  return lb.entries.filter(
    (e) =>
      e.enabled &&
      resolveEntryTriggerMode(e) === 'vector' &&
      lorebookEntryEmbeddingCorpus(e).trim().length > 0,
  )
}

export async function countLorebookVectorEntriesByIds(
  lorebookIds: string[],
): Promise<number> {
  const ids = uniqueLorebookIds(lorebookIds)
  let total = 0
  for (const id of ids) {
    const lb = await readLorebookById(id)
    if (!lb) continue
    total += vectorEntriesOf(lb).length
  }
  return total
}

/**
 * 按 id 列表重建资料库向量索引（fail-fast，用于会话级重建）。
 */
export async function reindexLorebooksByIds(
  lorebookIds: string[],
  creds: ResolvedEmbeddingCredentials,
  options?: { onEntryDone?: () => void },
): Promise<LorebookVectorReindexStats | LorebookVectorReindexError> {
  const ids = uniqueLorebookIds(lorebookIds)
  if (!ids.length) {
    return { lorebooksReindexed: 0, lorebookEntriesIndexed: 0 }
  }
  let lorebooksReindexed = 0
  let lorebookEntriesIndexed = 0
  for (const id of ids) {
    const lb = await readLorebookById(id)
    if (!lb) continue
    const result = await reindexOneLorebookVector(lb, creds, options)
    if ('error' in result) {
      return { ...result, lorebookId: id }
    }
    if (result.indexed > 0) {
      lorebooksReindexed += 1
    }
    lorebookEntriesIndexed += result.indexed
  }
  return { lorebooksReindexed, lorebookEntriesIndexed }
}

async function reindexOneLorebookVector(
  lb: Lorebook,
  creds?: ResolvedEmbeddingCredentials,
  options?: { onEntryDone?: () => void },
): Promise<{ indexed: number } | LorebookVectorReindexError> {
  const vectorEntries = vectorEntriesOf(lb)
  if (!vectorEntries.length) {
    await deleteLorebookVectorIndex(lb.id)
    return { indexed: 0 }
  }
  const rows: LoreEntryVectorRow[] = []
  for (const e of vectorEntries) {
    const corpus = lorebookEntryEmbeddingCorpus(e)
    if (creds) {
      const emb = await createEmbeddingWithCredentials(creds, corpus)
      if ('error' in emb) {
        return {
          error: emb.error,
          detail: emb.detail,
          lorebookId: lb.id,
        }
      }
      rows.push({
        entryId: e.id,
        lorebookId: lb.id,
        vector: emb.vector,
      })
      options?.onEntryDone?.()
      continue
    }
    const emb = await createEmbedding(corpus)
    if (!emb) continue
    rows.push({
      entryId: e.id,
      lorebookId: lb.id,
      vector: emb.vector,
    })
  }
  if (!rows.length) {
    await deleteLorebookVectorIndex(lb.id)
    return { indexed: 0 }
  }
  await replaceLorebookVectorIndex(lb.id, rows)
  return { indexed: rows.length }
}
