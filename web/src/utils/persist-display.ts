import type {
  ChatPersistPayload,
  ChatTurnItem,
  ReceiveItem,
  RetroPersistTurnPayload,
} from '@/types/chat-turn'

function resolvePersistPluginsForTurn(
  persist: ChatPersistPayload,
): unknown[] | undefined {
  if (Array.isArray(persist.plugins)) return persist.plugins
  return undefined
}

/** persist SSE/JSON 带回的 receive.runtime，合并进待发 receive */
export function mergeReceiveRuntimeFromPersist(
  receive: ReceiveItem,
  persist?: ChatPersistPayload,
): ReceiveItem {
  if (!persist?.ok) return receive
  const out = { ...receive }
  if (
    (out.estimatedTokens == null || out.estimatedTokens <= 0) &&
    typeof persist.estimatedTokens === 'number' &&
    persist.estimatedTokens > 0
  ) {
    out.estimatedTokens = persist.estimatedTokens
  }
  if (
    (out.completionTokens == null || out.completionTokens <= 0) &&
    typeof persist.completionTokens === 'number' &&
    persist.completionTokens > 0
  ) {
    out.completionTokens = persist.completionTokens
  }
  if (
    (out.durationMs == null || out.durationMs <= 0) &&
    typeof persist.durationMs === 'number' &&
    persist.durationMs > 0
  ) {
    out.durationMs = persist.durationMs
  }
  if (!out.model?.trim() && typeof persist.model === 'string' && persist.model.trim()) {
    out.model = persist.model.trim()
  }
  return out
}

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

/** 将 persist 落盘字段（plugins / turnId）合并进对应轮次，避免为插件快照全量 reload messages */
export function applyPersistTurnPlugins(
  turns: ChatTurnItem[],
  persist?: ChatPersistPayload,
): ChatTurnItem[] {
  if (!persist?.ok || typeof persist.turnOrdinal !== 'number') return turns
  const ord = persist.turnOrdinal
  const idx = turns.findIndex((t) => t.turnOrdinal === ord)
  if (idx < 0) return turns
  const cur = turns[idx]!
  const plugins = resolvePersistPluginsForTurn(persist)
  const turnId = persist.turnId?.trim()
  if (!plugins && !turnId) return turns
  return turns.map((t, i) =>
    i === idx
      ? {
          ...cur,
          ...(plugins ? { plugins } : {}),
          ...(turnId ? { turnId } : {}),
        }
      : t,
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
