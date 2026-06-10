import type {
  ChatPersistPayload,
  ChatTurnItem,
  RetroPersistTurnPayload,
} from '@/types/chat-turn'

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

function mapRetroReceives(
  item: RetroPersistTurnPayload,
  fallback: ChatTurnItem,
): ChatTurnItem['receives'] {
  if (item.receives?.length) {
    return item.receives.map((r, i) => {
      const prev = fallback.receives[i]
      return {
        id: r.id,
        content: r.content,
        ...(r.reasoning ? { reasoning: r.reasoning } : {}),
        ...(prev?.durationMs != null ? { durationMs: prev.durationMs } : {}),
        ...(prev?.estimatedTokens != null
          ? { estimatedTokens: prev.estimatedTokens }
          : {}),
        ...(prev?.completionTokens != null
          ? { completionTokens: prev.completionTokens }
          : {}),
        ...(prev?.model ? { model: prev.model } : {}),
      }
    })
  }
  const active = fallback.receives[item.activeReceiveIndex] ?? fallback.receives[0]
  return fallback.receives.map((r, i) =>
    i === item.activeReceiveIndex
      ? {
          ...r,
          content: item.finalAssistantContent,
          ...(item.finalAssistantReasoning !== undefined
            ? { reasoning: item.finalAssistantReasoning || undefined }
            : {}),
        }
      : r,
  )
}

/** 将 persist.retro 合并进已加载的 turns（仅 patch 列表中已存在的轮次） */
export function applyRetroPersistToTurns(
  turns: ChatTurnItem[],
  persist?: ChatPersistPayload,
): ChatTurnItem[] {
  if (!persist?.ok || !persist.retro?.length) return turns
  let next = turns
  for (const item of persist.retro) {
    const idx = next.findIndex((t) => t.turnOrdinal === item.turnOrdinal)
    if (idx < 0) continue
    const cur = next[idx]!
    const patched: ChatTurnItem = {
      ...cur,
      user: item.finalUserText,
      receives: mapRetroReceives(item, cur),
      activeReceiveIndex: Math.min(
        Math.max(0, item.activeReceiveIndex),
        Math.max(0, item.receives?.length ?? cur.receives.length) - 1,
      ),
    }
    next = next.map((t, i) => (i === idx ? patched : t))
  }
  return next
}
