import type { TurnMemoryRow } from './turn-memory-arrow.js'
import {
  optimizeChunkMemoryTable,
  upsertTurnMemoryRowsBatch,
} from './memory-store.js'

/** 尾块缓冲：每 N 轮批量 mergeInsert */
export const TAIL_MEMORY_BATCH_SIZE = 10
/** 尾块 debounce flush，避免进程退出前长期不落盘 */
export const TAIL_MEMORY_FLUSH_DEBOUNCE_MS = 30_000

interface BufferState {
  rows: Map<string, TurnMemoryRow>
  debounceTimer: ReturnType<typeof setTimeout> | null
}

const buffers = new Map<string, BufferState>()
/** 同一 chunk 串行 flush，避免并发 mergeInsert + PK 竞态 */
const flushChains = new Map<string, Promise<void>>()

function bufferKey(conversationId: string, chunkFileName: string): string {
  return `${conversationId}\0${chunkFileName}`
}

function getBufferState(key: string): BufferState {
  let s = buffers.get(key)
  if (!s) {
    s = { rows: new Map(), debounceTimer: null }
    buffers.set(key, s)
  }
  return s
}

function clearDebounce(state: BufferState): void {
  if (state.debounceTimer) {
    clearTimeout(state.debounceTimer)
    state.debounceTimer = null
  }
}

function scheduleDebounceFlush(
  conversationId: string,
  chunkFileName: string,
): void {
  const key = bufferKey(conversationId, chunkFileName)
  const state = getBufferState(key)
  clearDebounce(state)
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null
    void flushTurnMemoryBuffer(conversationId, chunkFileName).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[memory-tail-buffer] debounce flush failed:', e)
    })
  }, TAIL_MEMORY_FLUSH_DEBOUNCE_MS)
}

export async function flushTurnMemoryBuffer(
  conversationId: string,
  chunkFileName: string,
): Promise<void> {
  const key = bufferKey(conversationId, chunkFileName)
  const prev = flushChains.get(key) ?? Promise.resolve()
  const run = prev.then(() =>
    flushTurnMemoryBufferOnce(conversationId, chunkFileName),
  )
  flushChains.set(
    key,
    run.finally(() => {
      if (flushChains.get(key) === run) flushChains.delete(key)
    }),
  )
  await run
}

async function flushTurnMemoryBufferOnce(
  conversationId: string,
  chunkFileName: string,
): Promise<void> {
  const key = bufferKey(conversationId, chunkFileName)
  const state = buffers.get(key)
  if (!state || state.rows.size === 0) return

  clearDebounce(state)
  const rows = [...state.rows.values()]
  state.rows.clear()

  await upsertTurnMemoryRowsBatch(conversationId, chunkFileName, rows)
}

/** chunk 封存（滚动/拆分）：flush 尾缓冲 + optimize 收成单文件 */
export async function sealChunkMemorySegment(
  conversationId: string,
  chunkFileName: string,
): Promise<void> {
  await flushTurnMemoryBuffer(conversationId, chunkFileName)
  await optimizeChunkMemoryTable(conversationId, chunkFileName, {
    aggressiveCleanup: true,
  })
}

export function removeBufferedTurnMemory(
  conversationId: string,
  turnId: string,
): void {
  const id = turnId.trim()
  if (!id) return
  for (const [key, state] of buffers) {
    if (!key.startsWith(`${conversationId}\0`)) continue
    state.rows.delete(id)
  }
}

export function clearConversationMemoryBuffers(conversationId: string): void {
  const prefix = `${conversationId}\0`
  for (const [key, state] of buffers) {
    if (!key.startsWith(prefix)) continue
    clearDebounce(state)
    buffers.delete(key)
  }
}

/**
 * 尾块增量索引：缓冲每 10 轮 flush；非尾块直接写入。
 */
export async function queueTurnMemoryUpsert(
  conversationId: string,
  chunkFileName: string,
  row: TurnMemoryRow,
  isTailChunk: boolean,
): Promise<void> {
  if (!row.vector.length) return

  if (!isTailChunk) {
    await upsertTurnMemoryRowsBatch(conversationId, chunkFileName, [row])
    return
  }

  const key = bufferKey(conversationId, chunkFileName)
  const state = getBufferState(key)
  state.rows.set(row.turnId, row)
  scheduleDebounceFlush(conversationId, chunkFileName)

  if (state.rows.size >= TAIL_MEMORY_BATCH_SIZE) {
    await flushTurnMemoryBuffer(conversationId, chunkFileName)
  }
}
