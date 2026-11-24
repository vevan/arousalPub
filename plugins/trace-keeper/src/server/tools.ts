import { PLUGIN_ID } from '../constants.js'
import {
  DEFAULT_TRACE_BUNDLE,
  resolveTraceBundle,
} from '../bundle-resolve.js'
import { applyTracePatchOps } from '../json-patch-ops.js'
import { findTracePayloadInTurnPlugins } from '../trace-state-resolve.js'
import {
  resolveToolReadTurnCount,
  TOOL_READ_TURN_COUNT_MAX,
} from '../tool-read-turn-settings.js'
import { isTraceToolMode } from './agent-mode.js'
import {
  conversationHasTraceSnapshot,
  ensureLiveStagingForAgentRun,
  readLiveState,
  resolveBaselineState,
  resolveEpoch,
  writeLiveState,
} from './live-state.js'

type ToolApi = {
  pluginData: {
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
    delete?(
      scope: 'global' | 'conversation',
      relPath: string,
      conversationId?: string,
    ): Promise<void>
  }
  getUserPluginSettings: (pluginId: string) => Promise<Record<string, unknown>>
  getConversationPluginSettings: (
    conversationId: string,
    pluginId: string,
  ) => Promise<Record<string, unknown>>
  getConversationAgentMode?: (
    conversationId: string,
  ) => Promise<'on' | 'off'>
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
}

export type RunToolResult =
  | { ok: true; content: string }
  | { ok: false; code: string; detail?: string }

export type TraceToolBody = {
  arguments: string
  conversationId?: string
  signal?: AbortSignal
  agentRunId?: string
  baselineTurnOrdinalExclusive?: number
}

function parseArgs(argsJson: string): Record<string, unknown> {
  try {
    const v = JSON.parse(argsJson) as unknown
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>
    }
  } catch {
    /* ignore */
  }
  return {}
}

/** 优先参数 turns；否则读用户/会话 toolReadTurnCount 设置 */
async function resolveReadTurnLimit(
  api: ToolApi,
  conversationId: string,
  args: Record<string, unknown>,
): Promise<number> {
  const raw = args.turns ?? args.limit
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return Math.min(TOOL_READ_TURN_COUNT_MAX, Math.max(1, Math.round(raw)))
  }
  const [userSettings, convSettings] = await Promise.all([
    api.getUserPluginSettings(PLUGIN_ID),
    api.getConversationPluginSettings(conversationId, PLUGIN_ID),
  ])
  return resolveToolReadTurnCount(userSettings, convSettings)
}

function okJson(payload: unknown): RunToolResult {
  return { ok: true, content: JSON.stringify(payload) }
}

async function assertToolMode(
  api: ToolApi,
  conversationId: string,
): Promise<RunToolResult | null> {
  if (!(await isTraceToolMode(api, conversationId))) {
    return {
      ok: false,
      code: 'tool_mode_required',
      detail: 'Enable conversation Agent mode to use trace tools',
    }
  }
  return null
}

type StagingOpts = {
  agentRunId?: string
  baselineTurnOrdinalExclusive?: number
}

async function prepareStaging(
  api: ToolApi,
  conversationId: string,
  opts: StagingOpts,
): Promise<void> {
  const runId = opts.agentRunId?.trim()
  if (!runId) return
  await ensureLiveStagingForAgentRun(api, conversationId, runId, {
    baselineTurnOrdinalExclusive: opts.baselineTurnOrdinalExclusive,
  })
}

export async function runTraceReadTool(
  api: ToolApi,
  conversationId: string,
  argsJson: string,
  staging: StagingOpts = {},
): Promise<RunToolResult> {
  const gated = await assertToolMode(api, conversationId)
  if (gated) return gated
  await prepareStaging(api, conversationId, staging)

  const args = parseArgs(argsJson)
  const limit = await resolveReadTurnLimit(api, conversationId, args)
  const epoch = await resolveEpoch(api, conversationId)
  const turns = await api.readConversationTurnsTail(conversationId, limit)
  const maxEx = staging.baselineTurnOrdinalExclusive
  const snapshots: {
    turnOrdinal: number
    state: Record<string, unknown>
  }[] = []

  for (const turn of turns) {
    if (
      typeof maxEx === 'number' &&
      Number.isFinite(maxEx) &&
      turn.turnOrdinal >= maxEx
    ) {
      continue
    }
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
      snapshots.push({ turnOrdinal: turn.turnOrdinal, state: payload.state })
    }
  }

  const live = await readLiveState(api, conversationId)
  const liveOut =
    live && live.epoch === epoch
      ? { epoch: live.epoch, state: live.state, updatedAt: live.updatedAt }
      : null

  return okJson({
    ok: true,
    epoch,
    turns: limit,
    snapshots,
    live: liveOut,
  })
}

export async function runTraceInitTool(
  api: ToolApi,
  conversationId: string,
  _argsJson: string,
  staging: StagingOpts = {},
): Promise<RunToolResult> {
  const gated = await assertToolMode(api, conversationId)
  if (gated) return gated
  await prepareStaging(api, conversationId, staging)

  const epoch = await resolveEpoch(api, conversationId)
  const live = await readLiveState(api, conversationId)
  if (live && live.epoch === epoch) {
    return {
      ok: false,
      code: 'already_initialized',
      detail: 'live state already exists for current epoch',
    }
  }
  const hasSnap = await conversationHasTraceSnapshot(api, conversationId, epoch, {
    maxTurnOrdinalExclusive: staging.baselineTurnOrdinalExclusive,
  })
  if (hasSnap) {
    return {
      ok: false,
      code: 'already_initialized',
      detail: 'turn snapshot already exists for current epoch',
    }
  }

  const [userSettings, convSettings] = await Promise.all([
    api.getUserPluginSettings(PLUGIN_ID),
    api.getConversationPluginSettings(conversationId, PLUGIN_ID),
  ])
  const bundle = resolveTraceBundle({
    userSettings,
    convSettings,
    embeddedBundle: DEFAULT_TRACE_BUNDLE,
  })
  const state = { ...bundle.sampleState }
  const runId = staging.agentRunId?.trim()
  const doc = await writeLiveState(api, conversationId, {
    epoch,
    state,
    ...(runId ? { agentRunId: runId } : {}),
  })
  return okJson({
    ok: true,
    initialized: true,
    epoch: doc.epoch,
    state: doc.state,
  })
}

export async function runTracePatchTool(
  api: ToolApi,
  conversationId: string,
  argsJson: string,
  staging: StagingOpts = {},
): Promise<RunToolResult> {
  const gated = await assertToolMode(api, conversationId)
  if (gated) return gated
  await prepareStaging(api, conversationId, staging)

  const args = parseArgs(argsJson)
  const baseline = await resolveBaselineState(api, conversationId, {
    maxTurnOrdinalExclusive: staging.baselineTurnOrdinalExclusive,
  })
  if (!baseline.state) {
    return {
      ok: false,
      code: 'not_initialized',
      detail: 'Call trace_init first, or ensure a prior turn snapshot exists',
    }
  }

  const patched = applyTracePatchOps(baseline.state, args.ops)
  if (!patched.ok) {
    return {
      ok: false,
      code: patched.code,
      detail:
        patched.opIndex !== undefined
          ? `opIndex=${patched.opIndex}${patched.detail ? ` ${patched.detail}` : ''}`
          : patched.detail,
    }
  }

  const runId = staging.agentRunId?.trim()
  const doc = await writeLiveState(api, conversationId, {
    epoch: baseline.epoch,
    state: patched.state,
    ...(runId ? { agentRunId: runId } : {}),
  })
  return okJson({
    ok: true,
    applied: patched.applied,
    baselineSource: baseline.source,
    epoch: doc.epoch,
    state: doc.state,
  })
}

export async function runTool(
  name: string,
  body: TraceToolBody,
  api: ToolApi,
): Promise<RunToolResult> {
  if (body.signal?.aborted) {
    return { ok: false, code: 'cancelled' }
  }
  const conversationId = body.conversationId?.trim() ?? ''
  if (!conversationId) {
    return { ok: false, code: 'invalid_conversation_id' }
  }
  const argsJson = typeof body.arguments === 'string' ? body.arguments : '{}'
  const staging: StagingOpts = {
    ...(body.agentRunId ? { agentRunId: body.agentRunId } : {}),
    ...(typeof body.baselineTurnOrdinalExclusive === 'number'
      ? { baselineTurnOrdinalExclusive: body.baselineTurnOrdinalExclusive }
      : {}),
  }

  if (name === 'trace_read') {
    return runTraceReadTool(api, conversationId, argsJson, staging)
  }
  if (name === 'trace_init') {
    return runTraceInitTool(api, conversationId, argsJson, staging)
  }
  if (name === 'trace_patch') {
    return runTracePatchTool(api, conversationId, argsJson, staging)
  }
  return { ok: false, code: 'tool_not_found', detail: name }
}

/** 供 resolveTurnPluginEntriesFromAssistant：工具模式从 live 落盘 */
export async function liveStateTurnPluginEntries(
  conversationId: string,
  api: ToolApi,
): Promise<
  {
    pluginId: string
    schemaVersion: number
    payload: Record<string, unknown>
  }[]
> {
  try {
    const epoch = await resolveEpoch(api, conversationId)
    const live = await readLiveState(api, conversationId)
    if (!live || live.epoch !== epoch) return []
    return [
      {
        pluginId: PLUGIN_ID,
        schemaVersion: 1,
        payload: { state: live.state, epoch },
      },
    ]
  } catch {
    return []
  }
}
