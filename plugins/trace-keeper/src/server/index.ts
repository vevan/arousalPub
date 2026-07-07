import { PLUGIN_ID } from '../constants.js'
import {
  DEFAULT_TRACE_BUNDLE,
  resolveTraceBundle,
  trackerEpochFromSettings,
} from '../bundle-resolve.js'
import { extractTraceKeeperState } from '../parse-block.js'
import { buildTrackerSystemPrompt } from '../tracker-prompt.js'
import { regenerateSeparateState } from './separate-regenerate.js'

/** DOC/38 §3.2 · post-user 区最末（暂硬编码 · 见 DOC/04 可配置化 TODO） */
const TRACE_KEEPER_CHAT_DEPTH = 0
const TRACE_KEEPER_INJECTION_ORDER = 500

export type PluginPromptInjection = {
  role: 'system'
  content: string
  position: {
    kind: 'chat'
    depth: number
    order: number
  }
}

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
export { regenerateSeparateState } from './separate-regenerate.js'
export { patchTraceKeeperState } from './patch-state.js'
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
