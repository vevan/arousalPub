import { randomBytes } from 'node:crypto'

/** 与上游流式 timeout（300s）对齐，略留余量 */
export const CHAT_GENERATION_TTL_MS = 360_000

export type ChatGenerationEntry = {
  conversationId: string
  abort: AbortController
  createdAt: number
  /** 显式 cancel API 或同会话被新 generation 顶替；超时 abort 不为 true */
  userCancelled: boolean
}

const generations = new Map<string, ChatGenerationEntry>()

/** 16 hex chars；须与 conversationId 一并校验，降低误取消 */
export function generateChatGenerationId(): string {
  return randomBytes(8).toString('hex')
}

export function isChatGenerationIdFormat(id: string): boolean {
  return /^[a-f0-9]{16}$/i.test(id.trim())
}

/** 清理过期条目；过期时 abort 上游（不标 userCancelled，允许部分落盘语义由调用方决定） */
export function sweepExpiredChatGenerations(now = Date.now()): number {
  let removed = 0
  for (const [gid, entry] of generations) {
    if (now - entry.createdAt <= CHAT_GENERATION_TTL_MS) continue
    if (!entry.abort.signal.aborted) {
      entry.abort.abort()
    }
    generations.delete(gid)
    removed += 1
  }
  return removed
}

export function registerChatGeneration(
  conversationId: string,
  abort: AbortController,
  generationId = generateChatGenerationId(),
): string {
  sweepExpiredChatGenerations()
  const cid = conversationId.trim()
  const gid = generationId.trim()
  if (!cid || !gid) throw new Error('invalid_generation')
  if (!isChatGenerationIdFormat(gid)) throw new Error('invalid_generation_id')

  // 同会话只保留一个 in-flight：顶替旧条目并标 cancel，供旧 flush 跳过 persist
  for (const [id, entry] of generations) {
    if (entry.conversationId !== cid || id === gid) continue
    entry.userCancelled = true
    if (!entry.abort.signal.aborted) {
      entry.abort.abort()
    }
  }

  generations.set(gid, {
    conversationId: cid,
    abort,
    createdAt: Date.now(),
    userCancelled: false,
  })
  return gid
}

export function getChatGeneration(
  generationId: string,
): ChatGenerationEntry | undefined {
  return generations.get(generationId.trim())
}

/** 显式取消：abort 上游；返回是否命中且属该会话 */
export function cancelChatGeneration(
  conversationId: string,
  generationId: string,
): boolean {
  sweepExpiredChatGenerations()
  const gid = generationId.trim()
  const entry = generations.get(gid)
  if (!entry) return false
  if (entry.conversationId !== conversationId.trim()) return false
  entry.userCancelled = true
  if (!entry.abort.signal.aborted) {
    entry.abort.abort()
  }
  return true
}

export function unregisterChatGeneration(generationId: string): void {
  generations.delete(generationId.trim())
}

/** 测试用 */
export function __resetChatGenerationRegistryForTest(): void {
  generations.clear()
}

/** 测试用 */
export function __chatGenerationRegistrySizeForTest(): number {
  return generations.size
}
