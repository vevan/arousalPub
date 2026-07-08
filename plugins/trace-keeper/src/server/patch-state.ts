import { PLUGIN_ID } from '../constants.js'
import { normalizePatchState, upsertTraceKeeperBlockInAssistant } from '../parse-block.js'
import { trackerEpochFromSettings } from '../bundle-resolve.js'
import {
  activeSegmentReceive,
  type HostTurnWithSegments,
} from '../host-segment-snapshot.js'

type HostTurnSnapshot = HostTurnWithSegments & {
  turnOrdinal: number
}

type PatchApi = {
  getConversationPluginSettings: (
    conversationId: string,
    pluginId: string,
  ) => Promise<Record<string, unknown>>
  readConversationTurnAtOrdinal: (
    conversationId: string,
    turnOrdinal: number,
  ) => Promise<HostTurnSnapshot | null>
}

export interface PatchTraceKeeperStateInput {
  conversationId: string
  turnOrdinal: number
  state: unknown
  segmentIndex?: number
}

export type PatchTraceKeeperStateResult =
  | {
      ok: true
      state: Record<string, unknown>
      turnOrdinal: number
      receiveId?: string
      assistantContent: string
      entry: {
        pluginId: string
        schemaVersion: number
        payload: Record<string, unknown>
      }
    }
  | { ok: false; code: string }

export async function patchTraceKeeperState(
  input: PatchTraceKeeperStateInput,
  api: PatchApi,
): Promise<PatchTraceKeeperStateResult> {
  const conversationId = input.conversationId.trim()
  if (!conversationId) return { ok: false, code: 'invalid_conversation_id' }

  if (
    typeof input.turnOrdinal !== 'number' ||
    !Number.isFinite(input.turnOrdinal) ||
    input.turnOrdinal < 0
  ) {
    return { ok: false, code: 'invalid_turn_ordinal' }
  }

  const state = normalizePatchState(input.state)
  if (!state) return { ok: false, code: 'invalid_state' }

  const turnOrdinal = Math.round(input.turnOrdinal)
  const [convSettings, turn] = await Promise.all([
    api.getConversationPluginSettings(conversationId, PLUGIN_ID),
    api.readConversationTurnAtOrdinal(conversationId, turnOrdinal),
  ])
  if (!turn) return { ok: false, code: 'turn_not_found' }

  const epoch = trackerEpochFromSettings(convSettings)
  const receive = activeSegmentReceive(turn, input.segmentIndex)
  if (!receive?.id) return { ok: false, code: 'receive_not_found' }

  const payload: Record<string, unknown> = { state, epoch, receiveId: receive.id }
  const assistantContent = upsertTraceKeeperBlockInAssistant(receive.content, state)

  const entry = {
    pluginId: PLUGIN_ID,
    schemaVersion: 1,
    payload,
  }

  return {
    ok: true,
    state,
    turnOrdinal,
    receiveId: receive.id,
    assistantContent,
    entry,
  }
}
