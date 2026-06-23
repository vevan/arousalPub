import type {
  ChatPersistPayload,
  ChatTurnItem,
  RetroPersistTurnPayload,
} from '@/types/chat-turn'

const TRACE_KEEPER_BLOCK_RE =
  /<ex-trace-keeper>\s*([\s\S]*?)\s*<\/ex-trace-keeper>/gi

function parseTraceKeeperStateFromAssistant(
  content: string,
): Record<string, unknown> | null {
  const text = content.trim()
  if (!text) return null
  let last: Record<string, unknown> | null = null
  for (const match of text.matchAll(TRACE_KEEPER_BLOCK_RE)) {
    const inner = typeof match[1] === 'string' ? match[1].trim() : ''
    if (!inner) continue
    try {
      const parsed: unknown = JSON.parse(inner)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        last = parsed as Record<string, unknown>
      }
    } catch {
      /* ignore invalid blocks */
    }
  }
  return last
}

const TRACE_KEEPER_PLUGIN_ID = 'trace-keeper'

function payloadReceiveId(payload: Record<string, unknown> | undefined): string {
  const raw = payload?.receiveId
  return typeof raw === 'string' ? raw.trim() : ''
}

/** 与 server turn-plugin-utils.mergeTurnPluginEntry 一致 */
function mergeTurnPluginEntry(
  existing: unknown[] | undefined,
  entry: { pluginId: string; schemaVersion?: number; payload: Record<string, unknown> },
): unknown[] {
  const entryReceiveId = payloadReceiveId(entry.payload)
  const out: unknown[] = []
  for (const raw of existing ?? []) {
    if (!raw || typeof raw !== 'object') {
      out.push(raw)
      continue
    }
    const pluginId = (raw as { pluginId?: unknown }).pluginId
    if (typeof pluginId !== 'string' || pluginId !== entry.pluginId) {
      out.push(raw)
      continue
    }

    if (entry.pluginId !== TRACE_KEEPER_PLUGIN_ID) {
      continue
    }

    const prevPayload =
      (raw as { payload?: unknown }).payload &&
      typeof (raw as { payload?: unknown }).payload === 'object' &&
      !Array.isArray((raw as { payload?: unknown }).payload)
        ? (raw as { payload: Record<string, unknown> }).payload
        : undefined
    const prevReceiveId = payloadReceiveId(prevPayload)

    if (entryReceiveId) {
      if (prevReceiveId === entryReceiveId) continue
      out.push(raw)
      continue
    }

    if (prevReceiveId) {
      out.push(raw)
      continue
    }

    continue
  }
  out.push(entry)
  return out
}

function buildTraceKeeperEntryFromPersist(
  persist: ChatPersistPayload,
): { pluginId: string; schemaVersion: number; payload: Record<string, unknown> } | undefined {
  const receiveId = persist.receiveId?.trim()
  const content = persist.finalAssistantContent
  if (!receiveId || typeof content !== 'string' || !content.trim()) return undefined
  const state = parseTraceKeeperStateFromAssistant(content)
  if (!state) return undefined
  const epoch =
    typeof persist.trackerEpoch === 'number' && Number.isFinite(persist.trackerEpoch)
      ? Math.max(0, Math.round(persist.trackerEpoch))
      : 0
  return {
    pluginId: TRACE_KEEPER_PLUGIN_ID,
    schemaVersion: 1,
    payload: { state, epoch, receiveId },
  }
}

function resolvePersistPluginsForTurn(
  persist: ChatPersistPayload,
  existing: unknown[] | undefined,
): unknown[] | undefined {
  if (Array.isArray(persist.plugins)) return persist.plugins
  const entry = buildTraceKeeperEntryFromPersist(persist)
  if (!entry) return undefined
  return mergeTurnPluginEntry(existing, entry)
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
  const plugins = resolvePersistPluginsForTurn(persist, cur.plugins)
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
