import { PLUGIN_ID, type TraceKeeperPayload } from './constants.js'

export type TurnTraceLookup = {
  activeReceiveIndex?: number
  receives?: { id?: string; content?: string }[]
}

function payloadReceiveId(payload: unknown): string {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return ''
  const raw = (payload as { receiveId?: unknown }).receiveId
  return typeof raw === 'string' ? raw.trim() : ''
}

function activeReceiveId(ctx?: TurnTraceLookup): string | undefined {
  const receives = ctx?.receives
  if (!receives?.length) return undefined
  const idx = Math.min(
    Math.max(0, Math.floor(ctx?.activeReceiveIndex ?? 0)),
    receives.length - 1,
  )
  const id = receives[idx]?.id
  return typeof id === 'string' && id.trim() ? id.trim() : undefined
}

function payloadFromEntry(
  raw: Record<string, unknown>,
  epoch: number,
): TraceKeeperPayload | null {
  const payload = raw.payload
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null
  const state = (payload as { state?: unknown }).state
  const payloadEpoch = (payload as { epoch?: unknown }).epoch
  const entryEpoch =
    typeof payloadEpoch === 'number' && Number.isFinite(payloadEpoch)
      ? Math.round(payloadEpoch)
      : 0
  if (entryEpoch !== epoch) return null
  if (!state || typeof state !== 'object' || Array.isArray(state)) return null
  const receiveId = payloadReceiveId(payload)
  return {
    state: state as Record<string, unknown>,
    epoch: entryEpoch,
    ...(receiveId ? { receiveId } : {}),
  }
}

/** 仅从 turn.plugins[] 快照解析；不读 assistant 正文 */
export function findTracePayloadInTurnPlugins(
  plugins: unknown[] | undefined,
  epoch: number,
  ctx?: TurnTraceLookup,
): TraceKeeperPayload | null {
  const targetReceiveId = activeReceiveId(ctx)
  const list = Array.isArray(plugins) ? plugins : []

  if (targetReceiveId) {
    for (const raw of list) {
      if (!raw || typeof raw !== 'object') continue
      if ((raw as { pluginId?: unknown }).pluginId !== PLUGIN_ID) continue
      const hit = payloadFromEntry(raw as Record<string, unknown>, epoch)
      if (hit?.receiveId === targetReceiveId) return hit
    }
    return null
  }

  for (let i = list.length - 1; i >= 0; i -= 1) {
    const raw = list[i]
    if (!raw || typeof raw !== 'object') continue
    if ((raw as { pluginId?: unknown }).pluginId !== PLUGIN_ID) continue
    const hit = payloadFromEntry(raw as Record<string, unknown>, epoch)
    if (hit) return hit
  }

  return null
}

export type TraceTurnRef = {
  turnOrdinal: number
  plugins?: unknown[]
  activeReceiveIndex?: number
  receives?: { id?: string; content?: string }[]
}

function turnLookup(turn: TraceTurnRef): TurnTraceLookup {
  return {
    activeReceiveIndex: turn.activeReceiveIndex,
    receives: turn.receives,
  }
}

/** 从 tail 中按时间顺序取最多 limit 条 epoch 匹配、各轮 active receive 的 state */
export function resolveLiveTraceStates(
  turns: TraceTurnRef[],
  epoch: number,
  limit: number,
): { state: Record<string, unknown>; turnOrdinal: number }[] {
  const cap = Math.max(0, Math.floor(limit))
  if (cap <= 0 || turns.length === 0) return []
  const out: { state: Record<string, unknown>; turnOrdinal: number }[] = []
  for (let i = turns.length - 1; i >= 0 && out.length < cap; i -= 1) {
    const turn = turns[i]!
    const hit = findTracePayloadInTurnPlugins(turn.plugins, epoch, turnLookup(turn))
    if (hit) {
      out.push({ state: hit.state, turnOrdinal: turn.turnOrdinal })
    }
  }
  out.reverse()
  return out
}

/** live 视图：仅最后一轮 active receive 的 plugins 快照 */
export function resolveLiveTraceState(
  turns: TraceTurnRef[],
  epoch: number,
): { state: Record<string, unknown>; turnOrdinal: number } | null {
  if (turns.length === 0) return null
  const turn = turns[turns.length - 1]!
  const hit = findTracePayloadInTurnPlugins(turn.plugins, epoch, turnLookup(turn))
  if (!hit) return null
  return { state: hit.state, turnOrdinal: turn.turnOrdinal }
}

export function findTracePayloadForTurn(
  turn: TraceTurnRef | undefined,
  epoch: number,
): TraceKeeperPayload | null {
  if (!turn) return null
  return findTracePayloadInTurnPlugins(turn.plugins, epoch, turnLookup(turn))
}
