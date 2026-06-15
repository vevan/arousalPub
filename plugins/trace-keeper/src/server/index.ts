import { PLUGIN_ID } from '../constants.js'
import {
  DEFAULT_TRACE_BUNDLE,
  resolveTraceBundle,
  trackerEpochFromSettings,
  type TraceBundle,
} from '../bundle-resolve.js'
import { DEFAULT_SYSTEM_PROMPT_TEMPLATE } from '../default-prompt.js'
import {
  extractTraceKeeperState,
  isGuidanceGenerateRound,
} from '../parse-block.js'
import { resolveLiveTraceState } from '../panel-render.js'

type ServerApi = {
  getUserPluginSettings: (pluginId: string) => Promise<Record<string, unknown>>
  getConversationPluginSettings: (
    conversationId: string,
    pluginId: string,
  ) => Promise<Record<string, unknown>>
  readConversationTurnsTail: (
    conversationId: string,
    limit?: number,
  ) => Promise<
    { turnOrdinal: number; activeReceiveIndex: number; plugins: unknown[] }[]
  >
}

function buildTrackerSystemPrompt(
  bundle: TraceBundle,
  liveState: Record<string, unknown> | null,
): string {
  const prefix =
    bundle.systemPromptTemplate?.trim() || DEFAULT_SYSTEM_PROMPT_TEMPLATE
  const sampleJson = JSON.stringify(bundle.sampleState, null, 2)
  const liveJson = liveState
    ? JSON.stringify(liveState, null, 2)
    : JSON.stringify(bundle.sampleState, null, 2)
  return [
    prefix,
    '--- sample structure (reference only) ---',
    sampleJson,
    '--- current live state (update from this) ---',
    liveJson,
  ].join('\n')
}

export async function afterAssemblePrompts(
  ctx: {
    pluginId: string
    messages: { role: string; content: string }[]
    macroContext: { conversationId?: string }
    plugins?: Record<string, unknown> | null
  },
  api: ServerApi,
) {
  if (ctx.pluginId !== PLUGIN_ID) return ctx.messages
  if (isGuidanceGenerateRound(ctx.plugins ?? undefined)) return ctx.messages

  const conversationId = ctx.macroContext.conversationId?.trim()
  if (!conversationId) return ctx.messages

  const [userSettings, convSettings] = await Promise.all([
    api.getUserPluginSettings(PLUGIN_ID),
    api.getConversationPluginSettings(conversationId, PLUGIN_ID),
  ])
  const bundle = resolveTraceBundle({
    userSettings,
    convSettings,
    embeddedBundle: DEFAULT_TRACE_BUNDLE,
  })
  const epoch = trackerEpochFromSettings(convSettings)
  const tail = await api.readConversationTurnsTail(conversationId, 120)
  const live = resolveLiveTraceState(tail, epoch)
  const liveState = live?.state ?? null

  const systemText = buildTrackerSystemPrompt(bundle, liveState)
  return [
    ...ctx.messages,
    { role: 'system', content: systemText },
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
