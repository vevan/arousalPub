import { isValidConversationId } from './conversation-id.js'
import { mergeTurnPluginEntriesAtOrdinal } from './chat-storage.js'
import { createPluginServerHostApi } from './plugin-system/host-api.js'
import { loadEnabledServerPlugins } from './plugin-system/loader.js'
import type { TurnPluginEntry } from './plugin-types.js'

const TRACE_KEEPER_ID = 'trace-keeper'

export interface TraceKeeperRegenerateBody {
  conversationId?: string
  turnOrdinal?: number
}

export type TraceKeeperRegenerateRouteResult =
  | {
      ok: true
      state: Record<string, unknown>
      turnOrdinal: number
      receiveId: string
    }
  | { ok: false; code: string; status?: number }

export async function runTraceKeeperRegenerateRoute(
  pluginId: string,
  body: TraceKeeperRegenerateBody,
  userId?: string,
): Promise<TraceKeeperRegenerateRouteResult> {
  if (pluginId !== TRACE_KEEPER_ID) {
    return { ok: false, code: 'plugin_hook_not_supported', status: 404 }
  }

  const conversationId =
    typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
  if (!conversationId || !isValidConversationId(conversationId)) {
    return { ok: false, code: 'invalid_conversation_id', status: 400 }
  }

  const loaded = await loadEnabledServerPlugins(userId)
  const plugin = loaded.find((p) => p.id === TRACE_KEEPER_ID)
  if (!plugin || typeof plugin.module.regenerateSeparateState !== 'function') {
    return { ok: false, code: 'plugin_hook_not_supported', status: 404 }
  }

  const api = createPluginServerHostApi(TRACE_KEEPER_ID, userId)
  const turnOrdinal =
    typeof body.turnOrdinal === 'number' && Number.isFinite(body.turnOrdinal)
      ? Math.round(body.turnOrdinal)
      : undefined

  const result = await plugin.module.regenerateSeparateState(
    { conversationId, turnOrdinal },
    api,
  )
  if (!result.ok) {
    const status =
      result.code === 'parse_failed' || result.code === 'assistant_content_empty'
        ? 422
        : result.code === 'turn_not_found' || result.code === 'no_turns'
          ? 404
          : 400
    return { ok: false, code: result.code, status }
  }

  const merged = await mergeTurnPluginEntriesAtOrdinal(
    conversationId,
    result.turnOrdinal,
    [result.entry as TurnPluginEntry],
  )
  if (merged !== 'ok') {
    return { ok: false, code: 'turn_update_failed', status: 500 }
  }

  return {
    ok: true,
    state: result.state,
    turnOrdinal: result.turnOrdinal,
    receiveId: result.receiveId,
  }
}
