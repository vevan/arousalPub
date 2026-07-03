import type { TurnMemoryRow } from './turn-memory-arrow.js'
import {
  optimizeTurnMemoryTable,
  upsertTurnMemoryRowsBatch,
} from './memory-store.js'
/** @deprecated 尾段 buffer 已废弃；memory row 生成后直接入 Lance。 */
export async function flushTurnMemoryBuffer(
  _conversationId: string,
  _branchPath: string,
  _chunkFileName: string,
): Promise<void> {
  return
}

/** chunk 封存（滚动/拆分）：best-effort 合并 Lance 碎片 */
export async function sealChunkMemorySegment(
  conversationId: string,
  _chunkFileName: string,
  _branchPath = '',
): Promise<void> {
  await optimizeConversationMemoryTable(conversationId).catch((e) => {
    // eslint-disable-next-line no-console
    console.warn('[memory-tail-buffer] seal optimize failed:', e)
  })
}

/** 全量重建或删会话后可对整个 turn_memory 表 optimize */
export async function optimizeConversationMemoryTable(
  conversationId: string,
): Promise<void> {
  await optimizeTurnMemoryTable(conversationId, { aggressiveCleanup: true }).then(
    () => undefined,
  )
}

export function removeBufferedTurnMemory(
  _conversationId: string,
  _turnId: string,
): void {
  return
}

export function clearConversationMemoryBuffers(_conversationId: string): void {
  return
}

/** 增量索引：memory row 生成后直接进入 Lance 会话级写入队列。 */
export async function queueTurnMemoryUpsert(
  conversationId: string,
  _branchPath: string,
  _chunkFileName: string,
  row: TurnMemoryRow,
  _isTailChunk: boolean,
): Promise<void> {
  if (!row.vector.length) return
  await upsertTurnMemoryRowsBatch(conversationId, [row])
}
