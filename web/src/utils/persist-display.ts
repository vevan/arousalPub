import type { ChatPersistPayload } from '@/types/chat-turn'

/** persist SSE/JSON 带回 final* 时，用落盘正文替代流式 upstream 原文 */
export function resolveAssistantAfterPersist(
  assistantOut: string,
  reasoningOut: string | undefined,
  persist?: ChatPersistPayload,
): { content: string; reasoning?: string } {
  if (persist?.ok && typeof persist.finalAssistantContent === 'string') {
    return {
      content: persist.finalAssistantContent,
      reasoning:
        typeof persist.finalAssistantReasoning === 'string'
          ? persist.finalAssistantReasoning || undefined
          : reasoningOut,
    }
  }
  return { content: assistantOut, reasoning: reasoningOut }
}

/** 有 final* 时跳过全量 loadMessages，减少读盘延迟 */
export function shouldReloadMessagesAfterChat(
  assistantOut: string,
  persist?: ChatPersistPayload,
): boolean {
  if (!assistantOut.trim()) return false
  if (!persist) return true
  if (!persist.ok) return false
  return typeof persist.finalAssistantContent !== 'string'
}

export function resolveFinalUserTextAfterPersist(
  persist?: ChatPersistPayload,
): string | undefined {
  if (persist?.ok && typeof persist.finalUserText === 'string') {
    return persist.finalUserText
  }
  return undefined
}
