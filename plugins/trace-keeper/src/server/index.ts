import type { PluginPromptInjection } from '../../../shared/plugin-prompt-injection.js'
export type { PluginPromptInjection }
import { PLUGIN_ID } from '../constants.js'
import {
  DEFAULT_TRACE_BUNDLE,
  resolveTraceBundle,
  trackerEpochFromSettings,
} from '../bundle-resolve.js'
import { extractTraceKeeperState } from '../parse-block.js'
import { buildTrackerSystemPrompt } from '../tracker-prompt.js'
import { regenerateSeparateState } from './separate-regenerate.js'
import { patchTraceKeeperState } from './patch-state.js'

/** DOC/38 §3.2 · post-user 区最末（暂硬编码 · 见 DOC/04 可配置化 TODO） */
const TRACE_KEEPER_CHAT_DEPTH = 0
const TRACE_KEEPER_INJECTION_ORDER = 500

type ServerApi = {
  getUserPluginSettings: (pluginId: string) => Promise<Record<string, unknown>>
  getConversationPluginSettings: (
    conversationId: string,
    pluginId: string,
  ) => Promise<Record<string, unknown>>
  runPluginComplete?: (req: {
    conversationId?: string
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    responseFormat?: 'json_object' | 'text'
  }) => Promise<
    | { ok: true; content: string }
    | { ok: false; code: string }
  >
}

export type TraceKeeperInjectionContext = {
  pluginId: string
  macroContext: { conversationId?: string }
  plugins?: Record<string, unknown> | null
  tokenModel?: string
}

export { buildTrackerSystemPrompt } from '../tracker-prompt.js'
export { DEFAULT_TRACE_BUNDLE, resolveTraceBundle } from '../bundle-resolve.js'
export {
  formatPluginContextBlocks,
  TRACE_KEEPER_SEPARATE_LAYOUT,
} from './complete-context-hooks.js'

export async function resolveTraceKeeperInjection(
  ctx: TraceKeeperInjectionContext,
  api: ServerApi,
): Promise<{ systemText: string } | null> {
  if (ctx.pluginId !== PLUGIN_ID) return null

  const conversationId = ctx.macroContext.conversationId?.trim()
  if (!conversationId) return null

  const [userSettings, convSettings] = await Promise.all([
    api.getUserPluginSettings(PLUGIN_ID),
    api.getConversationPluginSettings(conversationId, PLUGIN_ID),
  ])
  const bundle = resolveTraceBundle({
    userSettings,
    convSettings,
    embeddedBundle: DEFAULT_TRACE_BUNDLE,
  })

  return {
    systemText: buildTrackerSystemPrompt(bundle),
  }
}

export async function resolveAfterAssemblePromptsAddition(
  ctx: TraceKeeperInjectionContext,
  api: ServerApi,
): Promise<PluginPromptInjection[] | null> {
  const injection = await resolveTraceKeeperInjection(ctx, api)
  if (!injection) return null
  return [
    {
      role: 'system',
      content: injection.systemText,
      position: {
        kind: 'chat',
        depth: TRACE_KEEPER_CHAT_DEPTH,
        injectionOrder: TRACE_KEEPER_INJECTION_ORDER,
      },
    },
  ]
}

export async function resolveTurnPluginEntriesFromAssistant(
  ctx: {
    assistantContent: string
    conversationId?: string
  },
  api: ServerApi,
) {
  const state = extractTraceKeeperState(ctx.assistantContent)
  if (!state) return []

  let epoch = 0
  const conversationId = ctx.conversationId?.trim()
  if (conversationId) {
    const convSettings = await api.getConversationPluginSettings(
      conversationId,
      PLUGIN_ID,
    )
    epoch = trackerEpochFromSettings(convSettings)
  }

  return [
    {
      pluginId: PLUGIN_ID,
      schemaVersion: 1,
      payload: { state, epoch },
    },
  ]
}

export async function resolveConversationPersistExtras(
  ctx: {
    conversationIndex: { id?: string; pluginSettings?: Record<string, unknown> }
  },
  api: ServerApi,
) {
  const conversationId = ctx.conversationIndex.id?.trim()
  if (!conversationId) return {}
  const convSettings = await api.getConversationPluginSettings(
    conversationId,
    PLUGIN_ID,
  )
  return { trackerEpoch: trackerEpochFromSettings(convSettings) }
}

export async function onCharacterPrimaryChanged(
  ctx: { conversationId: string },
  api: ServerApi,
) {
  const convSettings = await api.getConversationPluginSettings(
    ctx.conversationId,
    PLUGIN_ID,
  )
  const epoch = trackerEpochFromSettings(convSettings)
  return { pluginSettings: { trackerEpoch: epoch + 1 } }
}

export async function runPluginAction(
  action: string,
  body: Record<string, unknown>,
  api: ServerApi,
) {
  const conversationId =
    typeof body.conversationId === 'string' ? body.conversationId.trim() : ''
  if (!conversationId) {
    return { ok: false as const, code: 'invalid_conversation_id' }
  }

  if (action === 'regenerate-separate') {
    const turnOrdinal =
      typeof body.turnOrdinal === 'number' && Number.isFinite(body.turnOrdinal)
        ? Math.round(body.turnOrdinal)
        : undefined
    const debugCapture = body.debugCapture === true
    const result = await regenerateSeparateState(
      { conversationId, turnOrdinal, debugCapture },
      api as Parameters<typeof regenerateSeparateState>[1],
    )
    if (!result.ok) {
      const status =
        result.code === 'parse_failed' || result.code === 'assistant_content_empty'
          ? 422
          : result.code === 'turn_not_found' || result.code === 'no_turns'
            ? 404
            : 400
      return { ok: false as const, code: result.code, status, debug: result.debug }
    }
    if (!result.receiveId || typeof result.assistantContent !== 'string') {
      return { ok: false as const, code: 'turn_update_failed', status: 500 }
    }
    return {
      ok: true as const,
      state: result.state,
      turnOrdinal: result.turnOrdinal,
      receiveId: result.receiveId,
      ...(result.debug ? { debug: result.debug } : {}),
      turnMerge: {
        turnOrdinal: result.turnOrdinal,
        receiveId: result.receiveId,
        assistantContent: result.assistantContent,
        entry: result.entry,
      },
    }
  }

  if (action === 'patch-state') {
    const turnOrdinal =
      typeof body.turnOrdinal === 'number' && Number.isFinite(body.turnOrdinal)
        ? Math.round(body.turnOrdinal)
        : NaN
    const result = await patchTraceKeeperState(
      { conversationId, turnOrdinal, state: body.state },
      api as Parameters<typeof patchTraceKeeperState>[1],
    )
    if (!result.ok) {
      const status =
        result.code === 'invalid_state'
          ? 422
          : result.code === 'turn_not_found' || result.code === 'no_turns'
            ? 404
            : result.code === 'invalid_conversation_id' ||
                result.code === 'invalid_turn_ordinal'
              ? 400
              : 400
      return { ok: false as const, code: result.code, status }
    }
    if (!result.receiveId || typeof result.assistantContent !== 'string') {
      return { ok: false as const, code: 'receive_not_found', status: 500 }
    }
    return {
      ok: true as const,
      state: result.state,
      turnOrdinal: result.turnOrdinal,
      receiveId: result.receiveId,
      turnMerge: {
        turnOrdinal: result.turnOrdinal,
        receiveId: result.receiveId,
        assistantContent: result.assistantContent,
        entry: result.entry,
      },
    }
  }

  return { ok: false as const, code: 'unknown_action', status: 404 }
}
