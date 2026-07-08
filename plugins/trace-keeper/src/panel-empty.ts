import type { TracePanelMeta, TraceBundle } from './constants.js'
import { PLUGIN_ID } from './constants.js'
import { diagnoseAssistantTrace } from './parse-block.js'
import {
  findTracePayloadForTurn,
  renderTracePanelHtml,
} from './panel-render.js'
import { tracePanelMetaForSegment } from './trace-state-resolve.js'
import type { PinnedTraceView } from './state.js'
import {
  activeReceiveFromView,
  resolveViewSegmentIndex,
  turnHasAssistantReceives,
  type TurnViewRef,
} from './turn-view-segment.js'

function findPriorTraceStateForLive(
  turns: TurnViewRef[],
  epoch: number,
  currentTurn: TurnViewRef,
  currentSegmentIndex: number,
): { state: Record<string, unknown>; turnOrdinal: number; segmentIndex: number } | null {
  for (let si = currentSegmentIndex - 1; si >= 0; si -= 1) {
    const hit = findTracePayloadForTurn(currentTurn, epoch, si)
    if (hit) {
      return {
        state: hit.state,
        turnOrdinal: currentTurn.turnOrdinal,
        segmentIndex: si,
      }
    }
  }

  for (let i = turns.length - 2; i >= 0; i -= 1) {
    const turn = turns[i]!
    const segCount = turn.segments?.length ?? 0
    if (segCount > 0) {
      for (let si = segCount - 1; si >= 0; si -= 1) {
        const hit = findTracePayloadForTurn(turn, epoch, si)
        if (hit) {
          return {
            state: hit.state,
            turnOrdinal: turn.turnOrdinal,
            segmentIndex: si,
          }
        }
      }
      continue
    }
    const segIdx = resolveViewSegmentIndex(turn)
    const hit = findTracePayloadForTurn(turn, epoch, segIdx)
    if (hit) {
      return { state: hit.state, turnOrdinal: turn.turnOrdinal, segmentIndex: segIdx }
    }
  }
  return null
}

export type PanelEmptyReason =
  | 'empty_session'
  | 'no_data_history'
  | 'awaiting_reply'
  | 'no_block'
  | 'empty_block'
  | 'json_parse_failed'
  | 'snapshot_missing'
  | 'invalid_state'
  | 'render_failed'

export type { TurnViewRef } from './turn-view-segment.js'

export type PanelViewResolved =
  | {
      kind: 'content'
      html: string
      mode: 'live' | 'pinned'
      turnOrdinal: number
      segmentIndex: number
      epoch: number
      editState: Record<string, unknown>
      /** 等待当前轮回复时展示上一轮占位快照：禁用底部操作 */
      actionsDisabled?: boolean
    }
  | {
      kind: 'empty'
      reason: PanelEmptyReason
      detail?: string
      canRegenerate: boolean
      mode: 'live' | 'pinned'
      turnOrdinal?: number
      segmentIndex?: number
      epoch: number
    }

function activeReceiveContent(turn: TurnViewRef, segmentIndex: number): string {
  const rec = activeReceiveFromView(turn, segmentIndex)
  return typeof rec?.content === 'string' ? rec.content : ''
}

function activeReceiveId(turn: TurnViewRef, segmentIndex: number): string | undefined {
  const id = activeReceiveFromView(turn, segmentIndex)?.id
  return typeof id === 'string' && id.trim() ? id.trim() : undefined
}

/** 用户已发消息、助手尚未落盘任何 receive（普通 chat 流式等待） */
function isTurnAwaitingAssistantReply(turn: TurnViewRef, segmentIndex: number): boolean {
  return !activeReceiveFromView(turn, segmentIndex)
}

/** plugins[] 有条目且 epoch/receive 匹配但 state 非法 */
function detectInvalidPluginState(
  turn: TurnViewRef,
  epoch: number,
  segmentIndex: number,
): boolean {
  const targetReceiveId = activeReceiveId(turn, segmentIndex)
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
  segmentIndex: number,
): { reason: PanelEmptyReason; detail?: string } {
  if (detectInvalidPluginState(turn, epoch, segmentIndex)) {
    return { reason: 'invalid_state' }
  }
  const diagnosis = diagnoseAssistantTrace(activeReceiveContent(turn, segmentIndex))
  const reason = diagnosisToReason(diagnosis)
  const detail =
    diagnosis.kind === 'json_parse_failed' ? diagnosis.detail : undefined
  return { reason, detail }
}

function liveSegmentIndex(lastTurn: TurnViewRef): number {
  return resolveViewSegmentIndex(lastTurn)
}

export function resolvePanelView(
  bundle: TraceBundle,
  turns: TurnViewRef[],
  epoch: number,
  pinned: PinnedTraceView | null,
  isSeparateRegenerating = false,
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
      ? turns.find((t) => t.turnOrdinal === pinned.turnOrdinal)
      : lastTurn
  const viewingOrdinal = viewingTurn?.turnOrdinal
  const viewingSegmentIndex =
    pinned !== null
      ? pinned.segmentIndex
      : viewingTurn
        ? liveSegmentIndex(viewingTurn)
        : 0
  const isCurrentTurnView =
    viewingTurn !== undefined && viewingOrdinal === lastOrdinal

  if (!viewingTurn || viewingOrdinal === undefined) {
    return {
      kind: 'empty',
      reason: 'no_data_history',
      canRegenerate: false,
      mode,
      turnOrdinal: pinned?.turnOrdinal,
      segmentIndex: pinned?.segmentIndex,
      epoch,
    }
  }

  if (isCurrentTurnView && isSeparateRegenerating) {
    return {
      kind: 'empty',
      reason: 'awaiting_reply',
      canRegenerate: false,
      mode,
      turnOrdinal: viewingOrdinal,
      segmentIndex: viewingSegmentIndex,
      epoch,
    }
  }

  const hit = findTracePayloadForTurn(viewingTurn, epoch, viewingSegmentIndex)
  const meta: TracePanelMeta = {
    mode,
    turnOrdinal: viewingOrdinal,
    epoch,
    ...tracePanelMetaForSegment(viewingTurn, viewingSegmentIndex),
  }

  if (hit) {
    try {
      const html = renderTracePanelHtml(bundle, hit.state, meta)
      return {
        kind: 'content',
        html,
        mode,
        turnOrdinal: viewingOrdinal,
        segmentIndex: viewingSegmentIndex,
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
        segmentIndex: viewingSegmentIndex,
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
      segmentIndex: viewingSegmentIndex,
      epoch,
    }
  }

  const prior =
    isTurnAwaitingAssistantReply(viewingTurn, viewingSegmentIndex)
      ? findPriorTraceStateForLive(
          turns,
          epoch,
          viewingTurn,
          viewingSegmentIndex,
        )
      : null
  if (prior) {
    const priorTurn =
      turns.find((t) => t.turnOrdinal === prior.turnOrdinal) ?? viewingTurn
    try {
      const html = renderTracePanelHtml(bundle, prior.state, {
        mode,
        turnOrdinal: prior.turnOrdinal,
        epoch,
        ...tracePanelMetaForSegment(priorTurn, prior.segmentIndex),
      })
      return {
        kind: 'content',
        html,
        mode,
        turnOrdinal: prior.turnOrdinal,
        segmentIndex: prior.segmentIndex,
        epoch,
        editState: prior.state,
        actionsDisabled: true,
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
        canRegenerate: true,
        mode,
        turnOrdinal: viewingOrdinal,
        segmentIndex: viewingSegmentIndex,
        epoch,
      }
    }
  }

  const { reason, detail } = resolveCurrentTurnEmptyReason(
    viewingTurn,
    epoch,
    viewingSegmentIndex,
  )
  return {
    kind: 'empty',
    reason,
    detail,
    canRegenerate: turnHasAssistantReceives(viewingTurn),
    mode,
    turnOrdinal: viewingOrdinal,
    segmentIndex: viewingSegmentIndex,
    epoch,
  }
}

export function panelEmptyLocaleKey(reason: PanelEmptyReason): string {
  switch (reason) {
    case 'empty_session':
      return 'panelEmptyEmptySession'
    case 'no_data_history':
      return 'panelEmptyNoDataHistory'
    case 'awaiting_reply':
      return 'panelEmptyAwaitingReply'
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
