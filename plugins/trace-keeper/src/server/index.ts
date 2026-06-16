import { PLUGIN_ID } from '../constants.js'
import {
  DEFAULT_TRACE_BUNDLE,
  resolveTraceBundle,
  trackerEpochFromSettings,
} from '../bundle-resolve.js'
import { extractTraceKeeperState } from '../parse-block.js'
import { buildTrackerSystemPrompt } from '../tracker-prompt.js'
import { regenerateSeparateState } from './separate-regenerate.js'

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
export { regenerateSeparateState } from './separate-regenerate.js'
export { patchTraceKeeperState } from './patch-state.js'

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
): Promise<{ role: 'system'; content: string }[] | null> {
  const injection = await resolveTraceKeeperInjection(ctx, api)
  if (!injection) return null
  return [{ role: 'system', content: injection.systemText }]
}

export async function afterAssemblePrompts(
  ctx: TraceKeeperInjectionContext & {
    messages: { role: string; content: string }[]
  },
  api: ServerApi,
) {
  const addition = await resolveAfterAssemblePromptsAddition(ctx, api)
  if (!addition) return ctx.messages
  return [...ctx.messages, ...addition]
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
