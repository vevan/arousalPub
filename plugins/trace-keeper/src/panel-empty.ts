import type { TracePanelMeta, TraceBundle } from './constants.js'
import { PLUGIN_ID } from './constants.js'
import { diagnoseAssistantTrace } from './parse-block.js'
import {
  findTracePayloadForTurn,
  renderTracePanelHtml,
  type TraceTurnRef,
} from './panel-render.js'

export type PanelEmptyReason =
  | 'empty_session'
  | 'no_data_history'
  | 'no_block'
  | 'empty_block'
  | 'json_parse_failed'
  | 'snapshot_missing'
  | 'invalid_state'
  | 'render_failed'

export type TurnViewRef = TraceTurnRef & {
  turnOrdinal: number
  receives?: { id?: string; content?: string }[]
}

export type PanelViewResolved =
  | {
      kind: 'content'
      html: string
      mode: 'live' | 'pinned'
      turnOrdinal: number
      epoch: number
      editState: Record<string, unknown>
    }
  | {
      kind: 'empty'
      reason: PanelEmptyReason
      detail?: string
      canRegenerate: boolean
      mode: 'live' | 'pinned'
      turnOrdinal?: number
      epoch: number
    }

function activeReceiveContent(turn: TurnViewRef): string {
  const receives = turn.receives
  if (!receives?.length) return ''
  const idx = Math.min(
    Math.max(0, Math.floor(turn.activeReceiveIndex ?? 0)),
    receives.length - 1,
  )
  const content = receives[idx]?.content
  return typeof content === 'string' ? content : ''
}

function activeReceiveId(turn: TurnViewRef): string | undefined {
  const receives = turn.receives
  if (!receives?.length) return undefined
  const idx = Math.min(
    Math.max(0, Math.floor(turn.activeReceiveIndex ?? 0)),
    receives.length - 1,
  )
  const id = receives[idx]?.id
  return typeof id === 'string' && id.trim() ? id.trim() : undefined
}

/** plugins[] 有条目且 epoch/receive 匹配但 state 非法 */
function detectInvalidPluginState(
  turn: TurnViewRef,
  epoch: number,
): boolean {
  const targetReceiveId = activeReceiveId(turn)
  const list = Array.isArray(turn.plugins) ? turn.plugins : []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    if ((raw as { pluginId?: unknown }).pluginId !== PLUGIN_ID) continue
    const payload = (raw as { payload?: unknown }).payload
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) continue
    const p = payload as Record<string, unknown>
    const entryEpoch =
      typeof p.epoch === 'number' && Number.isFinite(p.epoch)
        ? Math.round(p.epoch)
        : 0
    if (entryEpoch !== epoch) continue
    const receiveId =
      typeof p.receiveId === 'string' ? p.receiveId.trim() : ''
    if (targetReceiveId && receiveId !== targetReceiveId) continue
    if (!targetReceiveId && receiveId) continue
    const state = p.state
    if (!state || typeof state !== 'object' || Array.isArray(state)) return true
  }
  return false
}

function diagnosisToReason(
  d: ReturnType<typeof diagnoseAssistantTrace>,
): PanelEmptyReason {
  switch (d.kind) {
    case 'no_block':
      return 'no_block'
    case 'empty_block':
      return 'empty_block'
    case 'json_parse_failed':
      return 'json_parse_failed'
    case 'valid_json':
      return 'snapshot_missing'
  }
}

function resolveCurrentTurnEmptyReason(
  turn: TurnViewRef,
  epoch: number,
): { reason: PanelEmptyReason; detail?: string } {
  if (detectInvalidPluginState(turn, epoch)) {
    return { reason: 'invalid_state' }
  }
  const diagnosis = diagnoseAssistantTrace(activeReceiveContent(turn))
  const reason = diagnosisToReason(diagnosis)
  const detail =
    diagnosis.kind === 'json_parse_failed' ? diagnosis.detail : undefined
  return { reason, detail }
}

export function resolvePanelView(
  bundle: TraceBundle,
  turns: TurnViewRef[],
  epoch: number,
  pinned: number | null,
): PanelViewResolved {
  if (turns.length === 0) {
    return {
      kind: 'empty',
      reason: 'empty_session',
      canRegenerate: false,
      mode: 'live',
      epoch,
    }
  }

  const lastTurn = turns[turns.length - 1]!
  const lastOrdinal = lastTurn.turnOrdinal
  const mode: 'live' | 'pinned' = pinned !== null ? 'pinned' : 'live'
  const viewingTurn =
    pinned !== null
      ? turns.find((t) => t.turnOrdinal === pinned)
      : lastTurn
  const viewingOrdinal = viewingTurn?.turnOrdinal
  const isCurrentTurnView =
    viewingTurn !== undefined && viewingOrdinal === lastOrdinal

  if (!viewingTurn || viewingOrdinal === undefined) {
    return {
      kind: 'empty',
      reason: 'no_data_history',
      canRegenerate: false,
      mode,
      turnOrdinal: pinned ?? undefined,
      epoch,
    }
  }

  const hit = findTracePayloadForTurn(viewingTurn, epoch)
  const meta: TracePanelMeta = {
    mode,
    turnOrdinal: viewingOrdinal,
    epoch,
  }

  if (hit) {
    try {
      const html = renderTracePanelHtml(bundle, hit.state, meta)
      return {
        kind: 'content',
        html,
        mode,
        turnOrdinal: viewingOrdinal,
        epoch,
        editState: hit.state,
      }
    } catch (e) {
      const detail =
        e instanceof Error
          ? e.message.length > 200
            ? `${e.message.slice(0, 200)}…`
            : e.message
          : undefined
      return {
        kind: 'empty',
        reason: 'render_failed',
        detail,
        canRegenerate: isCurrentTurnView,
        mode,
        turnOrdinal: viewingOrdinal,
        epoch,
      }
    }
  }

  if (!isCurrentTurnView) {
    return {
      kind: 'empty',
      reason: 'no_data_history',
      canRegenerate: false,
      mode,
      turnOrdinal: viewingOrdinal,
      epoch,
    }
  }

  const { reason, detail } = resolveCurrentTurnEmptyReason(viewingTurn, epoch)
  return {
    kind: 'empty',
    reason,
    detail,
    canRegenerate: true,
    mode,
    turnOrdinal: viewingOrdinal,
    epoch,
  }
}

export function panelEmptyLocaleKey(reason: PanelEmptyReason): string {
  switch (reason) {
    case 'empty_session':
      return 'panelEmptyEmptySession'
    case 'no_data_history':
      return 'panelEmptyNoDataHistory'
    case 'no_block':
      return 'panelEmptyNoBlock'
    case 'empty_block':
      return 'panelEmptyEmptyBlock'
    case 'json_parse_failed':
      return 'panelEmptyJsonParseFailed'
    case 'snapshot_missing':
      return 'panelEmptySnapshotMissing'
    case 'invalid_state':
      return 'panelEmptyInvalidState'
    case 'render_failed':
      return 'panelEmptyRenderFailed'
  }
}
