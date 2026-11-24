import { PLUGIN_ID } from '../constants.js'
import { findTracePayloadInTurnPlugins } from '../trace-state-resolve.js'
import { trackerEpochFromSettings } from '../bundle-resolve.js'

export const LIVE_STATE_FILE = 'live-state.json'

export type TraceLiveStateDoc = {
  epoch: number
  state: Record<string, unknown>
  updatedAt: string
  /** 本轮 Agent 运行 id；不同滑动/请求互不串 staging */
  agentRunId?: string
}

type PluginDataApi = {
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

type TurnsApi = {
  readConversationTurnsTail: (
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
  getConversationPluginSettings: (
    conversationId: string,
    pluginId: string,
  ) => Promise<Record<string, unknown>>
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

export function parseLiveStateDoc(raw: string | null): TraceLiveStateDoc | null {
  if (!raw?.trim()) return null
  try {
    const j = JSON.parse(raw) as unknown
    if (!isPlainObject(j)) return null
    const state = j.state
    if (!isPlainObject(state)) return null
    const epoch =
      typeof j.epoch === 'number' && Number.isFinite(j.epoch)
        ? Math.round(j.epoch)
        : 0
    const updatedAt =
      typeof j.updatedAt === 'string' && j.updatedAt.trim()
        ? j.updatedAt.trim()
        : new Date(0).toISOString()
    const agentRunId =
      typeof j.agentRunId === 'string' && j.agentRunId.trim()
        ? j.agentRunId.trim()
        : undefined
    return { epoch, state, updatedAt, ...(agentRunId ? { agentRunId } : {}) }
  } catch {
    return null
  }
}

export async function readLiveState(
  api: { pluginData: PluginDataApi },
  conversationId: string,
): Promise<TraceLiveStateDoc | null> {
  const raw = await api.pluginData.read(
    'conversation',
    LIVE_STATE_FILE,
    conversationId,
  )
  return parseLiveStateDoc(raw)
}

export async function writeLiveState(
  api: { pluginData: PluginDataApi },
  conversationId: string,
  doc: Omit<TraceLiveStateDoc, 'updatedAt'> & { updatedAt?: string },
): Promise<TraceLiveStateDoc> {
  const next: TraceLiveStateDoc = {
    epoch: doc.epoch,
    state: doc.state,
    updatedAt: doc.updatedAt ?? new Date().toISOString(),
    ...(doc.agentRunId?.trim()
      ? { agentRunId: doc.agentRunId.trim() }
      : {}),
  }
  await api.pluginData.write(
    'conversation',
    LIVE_STATE_FILE,
    JSON.stringify(next),
    conversationId,
  )
  return next
}

export async function deleteLiveState(
  api: {
    pluginData: PluginDataApi & {
      delete?(
        scope: 'global' | 'conversation',
        relPath: string,
        conversationId?: string,
      ): Promise<void>
    }
  },
  conversationId: string,
): Promise<void> {
  if (typeof api.pluginData.delete === 'function') {
    await api.pluginData.delete('conversation', LIVE_STATE_FILE, conversationId)
    return
  }
  // 无 delete 时写空对象不可取；改为写占位由 parse 拒绝——仍用 write 清掉语义
  await api.pluginData.write(
    'conversation',
    LIVE_STATE_FILE,
    JSON.stringify({ epoch: -1, state: null, updatedAt: new Date(0).toISOString() }),
    conversationId,
  )
}

/** 最近一轮同 epoch 的 snapshot（active segment / receive） */
export async function findLatestTurnSnapshotState(
  api: TurnsApi,
  conversationId: string,
  epoch: number,
  opts?: { scanLimit?: number; maxTurnOrdinalExclusive?: number },
): Promise<{ turnOrdinal: number; state: Record<string, unknown> } | null> {
  const scanLimit = opts?.scanLimit ?? 40
  const maxEx =
    typeof opts?.maxTurnOrdinalExclusive === 'number' &&
    Number.isFinite(opts.maxTurnOrdinalExclusive)
      ? Math.round(opts.maxTurnOrdinalExclusive)
      : undefined
  const turns = await api.readConversationTurnsTail(conversationId, scanLimit)
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!
    if (maxEx !== undefined && turn.turnOrdinal >= maxEx) continue
    const segIdx = Math.min(
      Math.max(0, turn.activeSegmentIndex || 0),
      Math.max(0, turn.segments.length - 1),
    )
    const seg = turn.segments[segIdx]
    const payload = findTracePayloadInTurnPlugins(turn.plugins, epoch, {
      activeReceiveIndex: seg?.activeReceiveIndex,
      receives: seg?.receives,
    })
    if (payload?.state) {
      return { turnOrdinal: turn.turnOrdinal, state: payload.state }
    }
  }
  return null
}

/**
 * 为本轮 Agent run 准备独立 live staging：
 * - 同 runId 且 epoch 匹配 → 复用
 * - 否则从「本 turn 之前」的 snapshot 重植（滑动互不串）
 */
export async function ensureLiveStagingForAgentRun(
  api: TurnsApi & { pluginData: PluginDataApi },
  conversationId: string,
  agentRunId: string,
  opts?: { baselineTurnOrdinalExclusive?: number },
): Promise<TraceLiveStateDoc | null> {
  const runId = agentRunId.trim()
  if (!runId) return readLiveState(api, conversationId)

  const epoch = await resolveEpoch(api, conversationId)
  const live = await readLiveState(api, conversationId)
  if (live && live.epoch === epoch && live.agentRunId === runId) {
    return live
  }

  const hit = await findLatestTurnSnapshotState(api, conversationId, epoch, {
    maxTurnOrdinalExclusive: opts?.baselineTurnOrdinalExclusive,
  })
  if (hit) {
    return writeLiveState(api, conversationId, {
      epoch,
      state: structuredClone(hit.state),
      agentRunId: runId,
    })
  }

  // 无历史 snapshot：清掉旧 live，迫使 init
  if (live) {
    await deleteLiveState(api, conversationId)
  }
  return null
}

export async function conversationHasTraceSnapshot(
  api: TurnsApi,
  conversationId: string,
  epoch: number,
  opts?: { maxTurnOrdinalExclusive?: number },
): Promise<boolean> {
  const hit = await findLatestTurnSnapshotState(api, conversationId, epoch, opts)
  return hit != null
}

export async function resolveEpoch(
  api: TurnsApi,
  conversationId: string,
): Promise<number> {
  const convSettings = await api.getConversationPluginSettings(
    conversationId,
    PLUGIN_ID,
  )
  return trackerEpochFromSettings(convSettings)
}

/** patch/read 基线：live → 否则最近 turn snapshot */
export async function resolveBaselineState(
  api: TurnsApi & { pluginData: PluginDataApi },
  conversationId: string,
  opts?: { maxTurnOrdinalExclusive?: number },
): Promise<{
  epoch: number
  state: Record<string, unknown> | null
  source: 'live' | 'turn' | 'none'
  turnOrdinal?: number
}> {
  const epoch = await resolveEpoch(api, conversationId)
  const live = await readLiveState(api, conversationId)
  if (live && live.epoch === epoch) {
    return { epoch, state: live.state, source: 'live' }
  }
  const turnHit = await findLatestTurnSnapshotState(api, conversationId, epoch, {
    maxTurnOrdinalExclusive: opts?.maxTurnOrdinalExclusive,
  })
  if (turnHit) {
    return {
      epoch,
      state: turnHit.state,
      source: 'turn',
      turnOrdinal: turnHit.turnOrdinal,
    }
  }
  return { epoch, state: null, source: 'none' }
}
