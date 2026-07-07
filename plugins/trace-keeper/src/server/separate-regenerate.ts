import { PLUGIN_ID } from '../constants.js'
import {
  DEFAULT_TRACE_BUNDLE,
  resolveTraceBundle,
  trackerEpochFromSettings,
} from '../bundle-resolve.js'
import {
  parseTraceKeeperJson,
  stripTraceKeeperBlocks,
  upsertTraceKeeperBlockInAssistant,
} from '../parse-block.js'
import { prepareTraceKeeperSeparateContextBlocks } from '../prepare-context.js'
import { resolveSeparateTurnCount } from '../separate-turn-settings.js'
import { TRACE_KEEPER_SEPARATE_LAYOUT } from '../shared/separate-prompt-layout.js'
import { buildSeparateSystemPrompt } from '../tracker-prompt.js'
import type { TraceKeeperSeparateDebug } from '../separate-debug.js'
import type { CompleteWithContextRequest } from '../../../shared/plugin-context-blocks.js'

type SeparateApi = {
  getUserPluginSettings: (pluginId: string) => Promise<Record<string, unknown>>
  getConversationPluginSettings: (
    conversationId: string,
    pluginId: string,
  ) => Promise<Record<string, unknown>>
  readConversationTurnsTail: (
    conversationId: string,
    limit?: number,
  ) => Promise<
    {
      turnOrdinal: number
      activeReceiveIndex: number
      userText?: string
      plugins: unknown[]
      receives: { id: string; content: string }[]
    }[]
  >
  readConversationTurnAtOrdinal: (
    conversationId: string,
    turnOrdinal: number,
  ) => Promise<{
    turnOrdinal: number
    activeReceiveIndex: number
    userText?: string
    plugins: unknown[]
    receives: { id: string; content: string }[]
  } | null>
  completeWithContext: (
    req: CompleteWithContextRequest,
  ) => Promise<
    | {
        ok: true
        content?: string
        messages: { role: string; content: string }[]
        debug?: Omit<TraceKeeperSeparateDebug, 'messages' | 'code'>
      }
    | {
        ok: false
        code: string
        detail?: string
        promptTokens?: number
        budget?: number
        messages?: { role: string; content: string }[]
        debug?: TraceKeeperSeparateDebug
      }
  >
}

export interface RegenerateSeparateInput {
  conversationId: string
  turnOrdinal?: number
  /** 会话 auditDebug.enabled 时由路由传入 */
  debugCapture?: boolean
}

export type RegenerateSeparateResult =
  | {
      ok: true
      state: Record<string, unknown>
      turnOrdinal: number
      receiveId: string
      assistantContent: string
      entry: {
        pluginId: string
        schemaVersion: number
        payload: Record<string, unknown>
      }
      debug?: TraceKeeperSeparateDebug
    }
  | { ok: false; code: string; debug?: TraceKeeperSeparateDebug }

function mergeSeparateDebug(
  messages: { role: string; content: string }[],
  code: string,
  extra?: TraceKeeperSeparateDebug,
): TraceKeeperSeparateDebug {
  return {
    messages,
    code,
    ...extra,
  }
}

function activeReceive(
  turn: {
    activeReceiveIndex: number
    receives: { id: string; content: string }[]
  },
): { id: string; content: string } | null {
  const receives = turn.receives
  if (!receives.length) return null
  const idx = Math.min(
    Math.max(0, Math.floor(turn.activeReceiveIndex)),
    receives.length - 1,
  )
  return receives[idx] ?? null
}

export async function regenerateSeparateState(
  input: RegenerateSeparateInput,
  api: SeparateApi,
): Promise<RegenerateSeparateResult> {
  const conversationId = input.conversationId.trim()
  if (!conversationId) return { ok: false, code: 'invalid_conversation_id' }

  const [userSettings, convSettings, tail] = await Promise.all([
    api.getUserPluginSettings(PLUGIN_ID),
    api.getConversationPluginSettings(conversationId, PLUGIN_ID),
    api.readConversationTurnsTail(conversationId, 500),
  ])

  const targetOrdinal =
    typeof input.turnOrdinal === 'number' && Number.isFinite(input.turnOrdinal)
      ? Math.round(input.turnOrdinal)
      : tail.length > 0
        ? tail[tail.length - 1]!.turnOrdinal
        : NaN

  if (!Number.isFinite(targetOrdinal)) {
    return { ok: false, code: 'no_turns' }
  }

  const turn = await api.readConversationTurnAtOrdinal(
    conversationId,
    targetOrdinal,
  )
  if (!turn) return { ok: false, code: 'turn_not_found' }

  const receive = activeReceive(turn)
  if (!receive?.id) return { ok: false, code: 'receive_not_found' }

  const assistantText = stripTraceKeeperBlocks(receive.content)
  if (!assistantText) return { ok: false, code: 'assistant_content_empty' }

  const bundle = resolveTraceBundle({
    userSettings,
    convSettings,
    embeddedBundle: DEFAULT_TRACE_BUNDLE,
  })
  const epoch = trackerEpochFromSettings(convSettings)
  const windowTurnCount = resolveSeparateTurnCount(userSettings, convSettings)
  const debugCapture = input.debugCapture === true

  const blocks = prepareTraceKeeperSeparateContextBlocks({
    targetOrdinal,
    windowTurnCount,
  })

  const result = await api.completeWithContext({
    conversationId,
    blocks,
    layout: TRACE_KEEPER_SEPARATE_LAYOUT,
    pluginSettings: {
      separateSystemPrompt: buildSeparateSystemPrompt(bundle),
    },
    anchorToTurn: targetOrdinal,
    responseFormat: 'json_object',
    captureDebug: debugCapture,
    fallbackToChat: true,
  })

  const messages = result.ok
    ? result.messages
    : (result.messages ?? result.debug?.messages ?? [])

  if (!result.ok) {
    return {
      ok: false,
      code: result.code,
      ...(debugCapture
        ? {
            debug: mergeSeparateDebug(messages, result.code, result.debug),
          }
        : {}),
    }
  }

  const content = result.content?.trim() ?? ''
  if (!content) {
    return {
      ok: false,
      code: 'parse_failed',
      ...(debugCapture
        ? { debug: mergeSeparateDebug(messages, 'parse_failed') }
        : {}),
    }
  }

  const state = parseTraceKeeperJson(content)
  if (!state) {
    return {
      ok: false,
      code: 'parse_failed',
      ...(debugCapture
        ? {
            debug: mergeSeparateDebug(messages, 'parse_failed', {
              assistantContent: content,
            }),
          }
        : {}),
    }
  }

  const entry = {
    pluginId: PLUGIN_ID,
    schemaVersion: 1,
    payload: { state, epoch, receiveId: receive.id },
  }

  const assistantContent = upsertTraceKeeperBlockInAssistant(receive.content, state)

  return {
    ok: true,
    state,
    turnOrdinal: targetOrdinal,
    receiveId: receive.id,
    assistantContent,
    entry,
    ...(debugCapture
      ? {
          debug: mergeSeparateDebug(messages, 'ok', {
            ...result.debug,
            assistantContent: content,
          }),
        }
      : {}),
  }
}
