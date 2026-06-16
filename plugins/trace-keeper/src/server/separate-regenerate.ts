import { PLUGIN_ID } from '../constants.js'
import {
  DEFAULT_TRACE_BUNDLE,
  resolveTraceBundle,
  trackerEpochFromSettings,
} from '../bundle-resolve.js'
import { parseTraceKeeperJson, stripTraceKeeperBlocks } from '../parse-block.js'
import { resolveLiveTraceStates } from '../trace-state-resolve.js'
import { resolveLiveStateTurnCount } from '../live-state-settings.js'
import { buildTrackerSystemPrompt } from '../tracker-prompt.js'

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
      plugins: unknown[]
      receives: { id: string; content: string }[]
    }[]
  >
  runPluginComplete: (req: {
    conversationId?: string
    messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    responseFormat?: 'json_object' | 'text'
  }) => Promise<
    | { ok: true; content: string }
    | { ok: false; code: string }
  >
}

export interface RegenerateSeparateInput {
  conversationId: string
  turnOrdinal?: number
}

export type RegenerateSeparateResult =
  | {
      ok: true
      state: Record<string, unknown>
      turnOrdinal: number
      receiveId: string
      entry: {
        pluginId: string
        schemaVersion: number
        payload: Record<string, unknown>
      }
    }
  | { ok: false; code: string }

const SEPARATE_PREFIX = [
  'Generate ONLY a single JSON object for the Trace Keeper scene state.',
  'Do not include markdown fences, XML tags, or roleplay prose.',
  'Match the sample structure exactly.',
].join('\n')

function buildSeparateSystemPrompt(
  bundle: ReturnType<typeof resolveTraceBundle>,
  liveStates: { state: Record<string, unknown>; turnOrdinal: number }[],
): string {
  return [SEPARATE_PREFIX, buildTrackerSystemPrompt(bundle, liveStates)].join('\n\n')
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
  if (!tail.length) return { ok: false, code: 'no_turns' }

  const targetOrdinal =
    typeof input.turnOrdinal === 'number' && Number.isFinite(input.turnOrdinal)
      ? Math.round(input.turnOrdinal)
      : tail[tail.length - 1]!.turnOrdinal

  const turn = tail.find((t) => t.turnOrdinal === targetOrdinal)
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
  const turnCount = resolveLiveStateTurnCount(userSettings, convSettings)
  const priorTurns = tail.filter((t) => t.turnOrdinal < targetOrdinal)
  const liveStates = resolveLiveTraceStates(
    priorTurns,
    epoch,
    Math.max(0, turnCount - 1),
  )

  const systemText = buildSeparateSystemPrompt(bundle, liveStates)
  const userContent = [
    'Based on the assistant reply below, output updated scene state JSON.',
    '---',
    assistantText,
  ].join('\n')

  const result = await api.runPluginComplete({
    conversationId,
    messages: [
      { role: 'system', content: systemText },
      { role: 'user', content: userContent },
    ],
    responseFormat: 'json_object',
  })
  if (!result.ok) return { ok: false, code: result.code }

  const state = parseTraceKeeperJson(result.content)
  if (!state) return { ok: false, code: 'parse_failed' }

  const entry = {
    pluginId: PLUGIN_ID,
    schemaVersion: 1,
    payload: { state, epoch, receiveId: receive.id },
  }

  return {
    ok: true,
    state,
    turnOrdinal: targetOrdinal,
    receiveId: receive.id,
    entry,
  }
}
