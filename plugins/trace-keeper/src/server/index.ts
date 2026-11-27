import type { PluginPromptInjection } from '../../../../shared/plugin-prompt-injection.js'
export type { PluginPromptInjection }
import {
  POST_USER_INJECTION_ORDER_SLOT_DEFAULTS,
  resolveAssembleInjectionOrderSlot,
} from '../../../../shared/post-user-injection-order.js'
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
import { segmentIndexForAction } from '../host-segment-snapshot.js'
import { isTraceToolMode } from './agent-mode.js'
import { LIVE_STATE_FILE } from './live-state.js'
import {
  liveStateTurnPluginEntries,
  runNode as runTraceNode,
  runTool as runTraceTool,
  runTraceExistsNode,
  runTraceInitTool,
  runTracePatchTool,
  runTraceReadTool,
} from './tools.js'

export {
  LIVE_STATE_FILE,
  runTraceExistsNode,
  runTraceInitTool,
  runTracePatchTool,
  runTraceReadTool,
}

/** DOC/devNotes/38 §3.2 · manifest `assembleInjection.slots.default` 可覆盖 */
const TRACE_KEEPER_CHAT_DEPTH = 0

type ServerApi = {
  getUserPluginSettings: (pluginId: string) => Promise<Record<string, unknown>>
  getConversationPluginSettings: (
    conversationId: string,
    pluginId: string,
  ) => Promise<Record<string, unknown>>
  getConversationAgentMode?: (
    conversationId: string,
  ) => Promise<'on' | 'off'>
  pluginData?: {
    read(
      scope: 'global' | 'conversation',
      relPath: string,
      conversationId?: string,
    ): Promise<string | null>
    write(
      scope: 'global' | 'conversation',
      relPath: string,
      content: string,
      conversationId?: string,
    ): Promise<void>
  }
  readConversationTurnsTail?: (
    conversationId: string,
    limit?: number,
  ) => Promise<
    {
      turnOrdinal: number
      plugins: unknown[]
      segments: {
        receives: { id: string; content: string }[]
        activeReceiveIndex: number
      }[]
      activeSegmentIndex: number
    }[]
  >
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
  injectionOrderSlots?: Record<string, number>
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
  const conversationId = ctx.macroContext.conversationId?.trim() ?? ''
  if (conversationId && (await isTraceToolMode(api, conversationId))) {
    // Agent / 工具模式：禁止 Together 注入（DOC/30 §2.3 禁双写）
    return null
  }
  const injection = await resolveTraceKeeperInjection(ctx, api)
  if (!injection) return null
  return [
    {
      role: 'system',
      content: injection.systemText,
      position: {
        kind: 'chat',
        depth: TRACE_KEEPER_CHAT_DEPTH,
        injectionOrder: resolveAssembleInjectionOrderSlot(
          ctx.injectionOrderSlots,
          'default',
          POST_USER_INJECTION_ORDER_SLOT_DEFAULTS.default,
        ),
      },
    },
  ]
}

export async function resolveTurnPluginEntriesFromAssistant(
  ctx: {
    assistantContent: string
    conversationId?: string
    /** 宿主传入时：仅本轮成功调用过 write/init 才从 live 落盘（避免无 patch 却「写入」） */
    agentCalledToolNames?: string[]
    /** PATCH 按正文同步：工具模式 state 不在正文，跳过以免 live 覆盖各 swipe */
    receiveContentSync?: boolean
  },
  api: ServerApi,
) {
  const conversationId = ctx.conversationId?.trim() ?? ''
  if (
    conversationId &&
    (await isTraceToolMode(api, conversationId)) &&
    api.pluginData &&
    api.readConversationTurnsTail
  ) {
    // 正文同步路径：保留既有 receive 快照，禁止用当前 live 写进每一个 swipe
    if (ctx.receiveContentSync === true) {
      return null
    }
    // Agent persist：仅本轮成功调用过 write/init 才从 live 落盘
    if (Array.isArray(ctx.agentCalledToolNames)) {
      const wrote = ctx.agentCalledToolNames.some(
        (n) => n === 'trace_patch' || n === 'trace_init',
      )
      if (!wrote) return []
      return liveStateTurnPluginEntries(conversationId, {
        pluginData: api.pluginData,
        getUserPluginSettings: api.getUserPluginSettings,
        getConversationPluginSettings: api.getConversationPluginSettings,
        getConversationAgentMode: api.getConversationAgentMode,
        readConversationTurnsTail: api.readConversationTurnsTail,
      })
    }
    // 其它未标注旁路：不从 live 推断（避免无 write 的路径误写入）
    return null
  }

  const state = extractTraceKeeperState(ctx.assistantContent)
  if (!state) return []

  let epoch = 0
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

export async function runTool(
  name: string,
  body: {
    arguments: string
    conversationId?: string
    signal?: AbortSignal
    agentRunId?: string
    baselineTurnOrdinalExclusive?: number
  },
  api: ServerApi,
) {
  if (!api.pluginData || !api.readConversationTurnsTail) {
    return { ok: false as const, code: 'host_api_incomplete' }
  }
  return runTraceTool(name, body, {
    pluginData: api.pluginData,
    getUserPluginSettings: api.getUserPluginSettings,
    getConversationPluginSettings: api.getConversationPluginSettings,
    getConversationAgentMode: api.getConversationAgentMode,
    readConversationTurnsTail: api.readConversationTurnsTail,
  })
}

export async function runNode(
  type: string,
  body: {
    inputs?: Record<string, unknown>
    params?: Record<string, unknown>
    conversationId?: string
    signal?: AbortSignal
    agentRunId?: string
    baselineTurnOrdinalExclusive?: number
  },
  api: ServerApi,
) {
  if (!api.pluginData || !api.readConversationTurnsTail) {
    return { ok: false as const, code: 'host_api_incomplete' }
  }
  return runTraceNode(type, body, {
    pluginData: api.pluginData,
    getUserPluginSettings: api.getUserPluginSettings,
    getConversationPluginSettings: api.getConversationPluginSettings,
    getConversationAgentMode: api.getConversationAgentMode,
    readConversationTurnsTail: api.readConversationTurnsTail,
  })
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
    const hostApi = api as Parameters<typeof regenerateSeparateState>[1]
    const targetOrdinal =
      turnOrdinal ??
      (await hostApi.readConversationTurnsTail(conversationId, 1)).slice(-1)[0]
        ?.turnOrdinal
    let segmentIndex: number | undefined
    if (typeof targetOrdinal === 'number') {
      const snap = await hostApi.readConversationTurnAtOrdinal(
        conversationId,
        targetOrdinal,
      )
      if (snap) {
        const resolved = segmentIndexForAction(snap, body)
        if (!resolved.ok) {
          return {
            ok: false as const,
            code: resolved.code,
            status: resolved.status,
          }
        }
        segmentIndex = resolved.segmentIndex
      }
    }
    const result = await regenerateSeparateState(
      {
        conversationId,
        turnOrdinal,
        segmentIndex,
        debugCapture,
      },
      hostApi,
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
    const hostApi = api as Parameters<typeof patchTraceKeeperState>[1]
    let segmentIndex: number | undefined
    if (Number.isFinite(turnOrdinal)) {
      const snap = await hostApi.readConversationTurnAtOrdinal(
        conversationId,
        Math.round(turnOrdinal),
      )
      if (snap) {
        const resolved = segmentIndexForAction(snap, body)
        if (!resolved.ok) {
          return {
            ok: false as const,
            code: resolved.code,
            status: resolved.status,
          }
        }
        segmentIndex = resolved.segmentIndex
      }
    }
    const result = await patchTraceKeeperState(
      {
        conversationId,
        turnOrdinal,
        state: body.state,
        ...(segmentIndex !== undefined ? { segmentIndex } : {}),
      },
      hostApi,
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
