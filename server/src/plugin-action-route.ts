import { isValidConversationId } from './conversation-id.js'
import { mergeTurnPluginEntriesAtOrdinal, readConversationIndex } from './chat-storage.js'
import { isAuditDebugWriteEnabled } from './chat-audit-file.js'
import { createPluginServerHostApi } from './plugin-system/host-api.js'
import { loadEnabledServerPlugins } from './plugin-system/loader.js'
import { readPluginManifest } from './plugin-system/manifest.js'
import type {
  PluginServerActionResult,
  PluginServerActionTurnMerge,
} from './plugin-system/types.js'
import type { TurnPluginEntry } from './plugin-types.js'

const ACTION_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

export type PluginActionRouteResult =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; code: string; status?: number; debug?: unknown }

function normalizeActionName(action: string): string | null {
  const name = action.trim()
  if (!name || !ACTION_NAME_RE.test(name)) return null
  return name
}

async function findServerActionDecl(
  pluginId: string,
  action: string,
): Promise<{ permissions: string[] } | null> {
  const manifest = await readPluginManifest(pluginId)
  if (!manifest?.serverActions?.length) return null
  for (const decl of manifest.serverActions) {
    if (decl.name === action) return decl
  }
  return null
}

function pickActionResponseFields(
  result: Extract<PluginServerActionResult, { ok: true }>,
): Record<string, unknown> {
  const { ok: _ok, turnMerge: _turnMerge, ...rest } = result
  return rest
}

async function applyTurnMerge(
  conversationId: string,
  turnMerge: PluginServerActionTurnMerge,
): Promise<'ok' | 'failed'> {
  const merged = await mergeTurnPluginEntriesAtOrdinal(
    conversationId,
    turnMerge.turnOrdinal,
    [turnMerge.entry as TurnPluginEntry],
    {
      receiveContent: {
        receiveId: turnMerge.receiveId,
        content: turnMerge.assistantContent,
      },
    },
  )
  return merged === 'ok' ? 'ok' : 'failed'
}

export async function runPluginActionRoute(
  pluginId: string,
  actionRaw: string,
  body: Record<string, unknown>,
  userId?: string,
): Promise<PluginActionRouteResult> {
  const action = normalizeActionName(actionRaw)
  if (!action) {
    return { ok: false, code: 'invalid_action', status: 400 }
  }

  const decl = await findServerActionDecl(pluginId, action)
  if (!decl) {
    return { ok: false, code: 'plugin_action_not_supported', status: 404 }
  }

  const loaded = await loadEnabledServerPlugins(userId)
  const plugin = loaded.find((p) => p.id === pluginId)
  if (!plugin || typeof plugin.module.runPluginAction !== 'function') {
    return { ok: false, code: 'plugin_action_not_supported', status: 404 }
  }

  const conversationId =
    typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
  if (conversationId && !isValidConversationId(conversationId)) {
    return { ok: false, code: 'invalid_conversation_id', status: 400 }
  }

  let actionBody: Record<string, unknown> = { ...body }
  if (conversationId) {
    const idx = await readConversationIndex(conversationId)
    if (idx && isAuditDebugWriteEnabled(idx)) {
      actionBody = { ...actionBody, debugCapture: true }
    }
  }

  const api = createPluginServerHostApi(pluginId, userId)
  const result = await plugin.module.runPluginAction(action, actionBody, api)
  if (!result.ok) {
    if (result.debug) {
      // eslint-disable-next-line no-console
      console.warn(`[plugin-action:${pluginId}:${action}] debug`, result.debug)
    }
    return {
      ok: false,
      code: result.code,
      status: result.status,
      debug: result.debug,
    }
  }

  if (result.turnMerge) {
    if (!conversationId) {
      return { ok: false, code: 'invalid_conversation_id', status: 400 }
    }
    const mergeStatus = await applyTurnMerge(conversationId, result.turnMerge)
    if (mergeStatus !== 'ok') {
      return { ok: false, code: 'turn_update_failed', status: 500 }
    }
  }

  return {
    ok: true,
    ...pickActionResponseFields(result),
  }
}

export async function listPluginActionPermissions(
  pluginId: string,
  actionRaw: string,
): Promise<string[] | null> {
  const action = normalizeActionName(actionRaw)
  if (!action) return null
  const decl = await findServerActionDecl(pluginId, action)
  return decl?.permissions ?? null
}

export function mapPluginActionErrorStatus(code: string, status?: number): number {
  if (typeof status === 'number' && Number.isFinite(status)) return status
  if (code === 'invalid_conversation_id' || code === 'invalid_turn_ordinal') {
    return 400
  }
  if (code === 'turn_not_found' || code === 'no_turns') return 404
  if (code === 'parse_failed' || code === 'invalid_state') return 422
  if (code === 'plugin_action_not_supported' || code === 'unknown_action') {
    return 404
  }
  return 502
}
