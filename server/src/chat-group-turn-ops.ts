/**
 * Group-chat turn persist orchestration: storage writes + group-chat resolve/audit/segments.
 * Call sites that need saveFirstTurn / append* / segment update import from here
 * so chat-storage.ts stays free of group-chat/* value imports.
 */
import { allocateShortId } from './short-id.js'
import { mergeTurnPluginEntry, attachReceiveIdToTurnPluginEntries } from './turn-plugin-utils.js'
import type { TurnPluginEntry } from './plugin-types.js'
import { mkdir } from 'node:fs/promises'
import type { ResolvedFeatureAudit } from './feature-binding-types.js'
import type { ChatAuditSnapshotInput } from './chat-audit-types.js'
import {
  appendChatAuditEntry,
  removeChatAuditEntriesAfterSegment,
} from './chat-audit-file.js'
import { normalizeBranchPath, chunkStorageRelativePath } from './chunk-path.js'
import {
  buildFirstChunkDescriptor,
  invalidateChunkIndexSyncCache,
  prepareTailChunkForAppend,
  readChunkContainingOrdinal,
  readConversationActiveBranchPath,
} from './chunk-chain.js'
import {
  scheduleMemoryIndexUpsert,
  sealChunkMemorySegment,
} from './memory-index.js'
import { buildReceiveRuntime, collectChunkEntityIds } from './chat-turn-accessors.js'
import type {
  AssistantSegmentRecord,
  ChunkFile,
  ConversationIndex,
  TurnReceive,
  TurnRecord,
} from './chat-turn-types.js'
import {
  conversationDir,
  readConversationIndex,
  resolvedCharacterIds,
  mutateBranchConversationIndex,
  writeChunkFile,
} from './chat-storage-io.js'
import { updateConversationIndexAndList } from './chat-storage.js'
import {
  initGroupChatTurnState,
  normalizeGroupChatSettings,
  recordSegmentSpeaker,
  type GroupChatTurnState,
} from './shared/group-chat-settings.js'
import {
  findReceiveInTurn,
  getActiveSegment,
  getActiveSegmentIndex,
  syncTurnSpeakerFromActiveSegment,
  rebuildGroupChatTurnStateFromTurn,
} from './group-chat/segments.js'
import { applyNextSpeakerStateToTurn } from './group-chat/resolve.js'
import {
  attachResolvedNextSpeakerAuditToActiveSegment,
  attachSegmentPickAuditToSegment,
  buildGroupChatAuditSnapshot,
} from './group-chat/audit.js'
import type {
  GroupChatSpeakerAudit,
  GroupChatResolveParams,
  ResolveNextSpeakerResult,
} from './group-chat/types.js'
import {
  applyTurnContentUpdate,
  applyTurnSegmentContentUpdate,
  auditReceiveIdForSegment,
  buildFirstSegmentOnTurn,
  finalizeAuditPersistDiskMs,
  mapReceivesWithShortIds,
  nowIso,
} from './chat-turn-mutate.js'
import { readGlobalChunkSettings } from './user-preferences-file.js'

function withGroupChatAuditSnapshot(
  snapshot: ChatAuditSnapshotInput | undefined,
  segmentSpeakerCharacterId: string,
  segmentPick?: GroupChatSpeakerAudit,
  nextResolved?: ResolveNextSpeakerResult,
): ChatAuditSnapshotInput | undefined {
  if (!snapshot) return undefined
  if (!segmentPick && !nextResolved?.groupChatAudit) return snapshot
  return {
    ...snapshot,
    groupChat: buildGroupChatAuditSnapshot({
      segmentSpeakerCharacterId,
      segmentPick,
      nextSpeaker: nextResolved?.groupChatAudit,
    }),
  }
}

/** 首条用户消息 + 首条助手回复落盘后调用：写 chunk、更新会话索引与列表 */
export async function saveFirstTurn(params: {
  conversationId: string
  userText: string
  assistantText: string
  reasoning?: string
  model?: string
  durationMs?: number
  estimatedTokens?: number
  completionTokens?: number
  resolvedFeature?: ResolvedFeatureAudit
  /** debug 审计快照（服务端组装；见 DOC/devNotes/24） */
  auditSnapshot?: ChatAuditSnapshotInput
  turnPluginEntries?: TurnPluginEntry[]
  speakerCharacterId?: string
  speakerQueue?: string[]
  nextSpeakerHint?: string
  groupChatTurnState?: GroupChatTurnState
  skipSpeakQuotaDeduction?: boolean
  groupChatResolveAfterSegment?: GroupChatResolveParams
  groupChatResolveOut?: { nextResolved?: ResolveNextSpeakerResult }
  segmentPickAudit?: GroupChatSpeakerAudit
}): Promise<{
  index: ConversationIndex
  chunk: ChunkFile
  nextResolved?: ResolveNextSpeakerResult
} | null> {
  const {
    conversationId,
    userText,
    assistantText,
    reasoning,
    model,
    durationMs,
    estimatedTokens,
    completionTokens,
    resolvedFeature,
    auditSnapshot,
    turnPluginEntries,
    speakerCharacterId,
    speakerQueue,
    nextSpeakerHint,
    groupChatTurnState,
    skipSpeakQuotaDeduction,
    groupChatResolveAfterSegment,
    segmentPickAudit,
  } = params
  const auditStorageStartedAt =
    auditSnapshot?.performance?.persistMs !== undefined ? performance.now() : 0
  let idx = await readConversationIndex(conversationId)
  if (!idx) return null
  if (idx.headChunkFile) {
    return null
  }

  const used = new Set<string>()
  const turnId = allocateShortId(used)
  const turnCreatedAt = nowIso()
  const receiveRuntime = buildReceiveRuntime({
    model,
    durationMs,
    estimatedTokens,
    completionTokens,
    resolvedFeature,
  })
  const receives = mapReceivesWithShortIds(
    [
      {
        id: '',
        content: assistantText,
        ...(reasoning != null && reasoning !== ''
          ? { reasoning: reasoning.trim() }
          : {}),
        runtime: receiveRuntime,
      },
    ],
    used,
  )
  const activeReceiveIndex = 0
  const receiveId = receives[activeReceiveIndex]?.id?.trim() ?? ''
  const defaultSpeaker =
    speakerCharacterId?.trim() ||
    idx?.characterIds?.[0]?.trim() ||
    ''
  const turn: TurnRecord = {
    turnId,
    turnOrdinal: 0,
    createdAt: turnCreatedAt,
    send: { userText },
    plugins: (attachReceiveIdToTurnPluginEntries(turnPluginEntries, receiveId) ?? []).reduce<
      unknown[]
    >((acc, entry) => mergeTurnPluginEntry(acc, entry), []),
    segments: [],
    activeSegmentIndex: 0,
    ...(Array.isArray(speakerQueue) && speakerQueue.length > 0
      ? { speakerQueue }
      : {}),
  }
  buildFirstSegmentOnTurn(turn, used, {
    speakerCharacterId: defaultSpeaker,
    receives,
    activeReceiveIndex,
    nextSpeakerHint,
  })
  if (groupChatTurnState) {
    turn.groupChatTurnState = groupChatTurnState
    if (!skipSpeakQuotaDeduction) {
      turn.groupChatTurnState = recordSegmentSpeaker(
        groupChatTurnState,
        defaultSpeaker,
      )
    } else {
      turn.groupChatTurnState = recordSegmentSpeaker(
        groupChatTurnState,
        defaultSpeaker,
        { skipQuotaDeduction: true },
      )
    }
  }

  let nextResolved: ResolveNextSpeakerResult | undefined
  if (groupChatResolveAfterSegment) {
    nextResolved = applyNextSpeakerStateToTurn(
      turn,
      groupChatResolveAfterSegment,
    )
    attachResolvedNextSpeakerAuditToActiveSegment(
      turn,
      defaultSpeaker,
      nextResolved.groupChatAudit,
    )
  }
  attachSegmentPickAuditToSegment(turn, 0, segmentPickAudit)

  const chunkSettings = await readGlobalChunkSettings()
  const { fileName: firstChunkFile, meta: firstMeta } = buildFirstChunkDescriptor(
    chunkSettings.turnsPerFile,
  )

  const chunk: ChunkFile = {
    schemaVersion: 1,
    meta: firstMeta,
    turns: [turn],
  }

  await mkdir(conversationDir(conversationId), { recursive: true })
  await writeChunkFile(conversationId, firstChunkFile, chunk)

  const t = nowIso()
  // CL8 收尾：统一走组合 API（含 turnStats 首写统计）
  const written = await updateConversationIndexAndList(
    conversationId,
    (fresh) => {
      if (fresh.headChunkFile) return null
      fresh.headChunkFile = firstChunkFile
      fresh.tailChunkFile = firstChunkFile
      fresh.updatedAt = t
      return fresh
    },
    {
      turnStats: { turnCount: 1, lastChatAt: turn.createdAt ?? null },
    },
  )
  if (!written) return null
  idx = written

  /** 对话落盘成功后再写快照；无有效 messages 或索引关闭写入时不落盘 */
  if (auditSnapshot !== undefined) {
    finalizeAuditPersistDiskMs(auditSnapshot, auditStorageStartedAt)
    const idxForAudit = await readConversationIndex(conversationId)
    const snapshot = withGroupChatAuditSnapshot(
      auditSnapshot,
      defaultSpeaker,
      segmentPickAudit,
      nextResolved,
    )
    await appendChatAuditEntry(conversationId, idxForAudit, {
      chunkName: firstChunkFile,
      turnId,
      turnOrdinal: 0,
      segmentIndex: 0,
      receiveId,
      snapshot: snapshot ?? auditSnapshot,
    })
  }

  scheduleMemoryIndexUpsert(conversationId, turn, firstChunkFile)

  return { index: idx, chunk, nextResolved }
}

/** 在已有尾块末尾追加一轮对话（默认写入 index.activeBranchPath） */
export async function appendConversationTurn(params: {
  conversationId: string
  userText: string
  receives: TurnReceive[]
  activeReceiveIndex: number
  auditSnapshot?: ChatAuditSnapshotInput
  turnPluginEntries?: TurnPluginEntry[]
  /** 省略则读会话根 index.activeBranchPath；"" 为主路径 */
  branchPath?: string | null
  speakerCharacterId?: string
  speakerQueue?: string[]
  nextSpeakerHint?: string
  groupChatTurnState?: GroupChatTurnState
  skipSpeakQuotaDeduction?: boolean
  groupChatResolveAfterSegment?: GroupChatResolveParams
  groupChatResolveOut?: { nextResolved?: ResolveNextSpeakerResult }
  segmentPickAudit?: GroupChatSpeakerAudit
}): Promise<boolean> {
  const {
    conversationId,
    userText,
    receives,
    activeReceiveIndex,
    auditSnapshot,
    turnPluginEntries,
    speakerCharacterId,
    speakerQueue,
    nextSpeakerHint,
    groupChatTurnState,
    skipSpeakQuotaDeduction,
    groupChatResolveAfterSegment,
    groupChatResolveOut,
    segmentPickAudit,
  } = params
  const auditStorageStartedAt =
    auditSnapshot?.performance?.persistMs !== undefined ? performance.now() : 0
  if (!receives.length) return false
  const branchPath =
    params.branchPath !== undefined
      ? normalizeBranchPath(params.branchPath ?? '')
      : await readConversationActiveBranchPath(conversationId)
  const prepared = await prepareTailChunkForAppend(conversationId, branchPath)
  if (!prepared) return false
  const { tailFile: chunkName, tail: chunk, sealedChunkFiles } = prepared
  for (const sealed of sealedChunkFiles) {
    void sealChunkMemorySegment(conversationId, sealed, branchPath).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[chat-group-turn-ops] seal chunk memory failed:', e)
    })
  }
  const nextOrd =
    chunk.turns.length === 0
      ? chunk.meta.ordinalRange.start
      : Math.max(...chunk.turns.map((t) => t.turnOrdinal)) + 1
  const used = collectChunkEntityIds(chunk)
  const turnCreatedAt = nowIso()
  const mappedReceives = mapReceivesWithShortIds(receives, used)
  const activeIdx = Math.min(
    Math.max(0, activeReceiveIndex),
    mappedReceives.length - 1,
  )
  const receiveId = mappedReceives[activeIdx]?.id?.trim() ?? ''
  const rootIdxForSpeaker = await readConversationIndex(conversationId)
  const defaultSpeaker =
    speakerCharacterId?.trim() ||
    rootIdxForSpeaker?.characterIds?.[0]?.trim() ||
    ''
  const turn: TurnRecord = {
    turnId: allocateShortId(used),
    turnOrdinal: nextOrd,
    createdAt: turnCreatedAt,
    send: { userText },
    plugins: (attachReceiveIdToTurnPluginEntries(turnPluginEntries, receiveId) ?? []).reduce<
      unknown[]
    >((acc, entry) => mergeTurnPluginEntry(acc, entry), []),
    segments: [],
    activeSegmentIndex: 0,
    ...(Array.isArray(speakerQueue) && speakerQueue.length > 0
      ? { speakerQueue }
      : {}),
  }
  buildFirstSegmentOnTurn(turn, used, {
    speakerCharacterId: defaultSpeaker,
    receives: mappedReceives,
    activeReceiveIndex: activeIdx,
    nextSpeakerHint,
  })
  if (groupChatTurnState) {
    turn.groupChatTurnState = recordSegmentSpeaker(
      groupChatTurnState,
      defaultSpeaker,
      skipSpeakQuotaDeduction ? { skipQuotaDeduction: true } : undefined,
    )
  }
  let nextResolved: ResolveNextSpeakerResult | undefined
  if (groupChatResolveAfterSegment) {
    nextResolved = applyNextSpeakerStateToTurn(
      turn,
      groupChatResolveAfterSegment,
    )
    if (groupChatResolveOut) {
      groupChatResolveOut.nextResolved = nextResolved
    }
    attachResolvedNextSpeakerAuditToActiveSegment(
      turn,
      defaultSpeaker,
      nextResolved.groupChatAudit,
    )
  }
  attachSegmentPickAuditToSegment(turn, 0, segmentPickAudit)
  chunk.turns.push(turn)
  chunk.meta.ordinalRange = {
    start:
      chunk.turns.length === 1
        ? turn.turnOrdinal
        : Math.min(chunk.meta.ordinalRange.start, turn.turnOrdinal),
    end: turn.turnOrdinal,
  }
  const storagePath = chunkStorageRelativePath(branchPath, chunkName)
  await writeChunkFile(conversationId, storagePath, chunk)
  const t = nowIso()
  // CL5：追加到 active 路径用写事件增量（+1）；否则回退全量扫描
  const appendingToActive =
    branchPath ===
    normalizeBranchPath(rootIdxForSpeaker?.activeBranchPath ?? '')
  const listOpts = appendingToActive
    ? { turnStats: { appendedTurnCount: 1, lastChatAt: turnCreatedAt } }
    : { refreshConversationStats: true }
  if (branchPath) {
    await mutateBranchConversationIndex(
      conversationId,
      branchPath,
      (fresh) => {
        if (prepared.isNewBranchChunk || !fresh.headChunkFile) {
          fresh.headChunkFile = chunkName
        }
        fresh.tailChunkFile = chunkName
        fresh.updatedAt = t
        return fresh
      },
    )
    // CL8：根 index 仅触 updatedAt + 列表，走组合 API
    await updateConversationIndexAndList(
      conversationId,
      (fresh) => {
        fresh.updatedAt = t
        return fresh
      },
      listOpts,
    )
  } else {
    await updateConversationIndexAndList(
      conversationId,
      (fresh) => {
        if (prepared.isNewBranchChunk || !fresh.headChunkFile) {
          fresh.headChunkFile = chunkName
        }
        fresh.tailChunkFile = chunkName
        fresh.updatedAt = t
        return fresh
      },
      listOpts,
    )
  }
  invalidateChunkIndexSyncCache(conversationId)
  if (auditSnapshot !== undefined) {
    finalizeAuditPersistDiskMs(auditSnapshot, auditStorageStartedAt)
    const idxForAudit = await readConversationIndex(conversationId)
    const snapshot = withGroupChatAuditSnapshot(
      auditSnapshot,
      defaultSpeaker,
      segmentPickAudit,
      groupChatResolveOut?.nextResolved,
    )
    await appendChatAuditEntry(conversationId, idxForAudit, {
      chunkName: storagePath,
      turnId: turn.turnId,
      turnOrdinal: turn.turnOrdinal,
      segmentIndex: 0,
      receiveId,
      snapshot: snapshot ?? auditSnapshot,
    })
  }
  scheduleMemoryIndexUpsert(
    conversationId,
    turn as TurnRecord,
    chunkName,
    branchPath,
  )
  return true
}

/** 向已有 turn 追加新 segment（groupContinue） */
export async function appendSegmentToTurn(params: {
  conversationId: string
  turnOrdinal: number
  speakerCharacterId: string
  receives: TurnReceive[]
  activeReceiveIndex: number
  nextSpeakerHint?: string
  auditSnapshot?: ChatAuditSnapshotInput
  turnPluginEntries?: TurnPluginEntry[]
  defaultSpeakerCharacterId?: string
  skipSpeakQuotaDeduction?: boolean
  groupChatResolveAfterSegment?: GroupChatResolveParams
  groupChatResolveOut?: { nextResolved?: ResolveNextSpeakerResult }
  segmentPickAudit?: GroupChatSpeakerAudit
}): Promise<boolean> {
  const {
    conversationId,
    turnOrdinal,
    speakerCharacterId,
    receives,
    activeReceiveIndex,
    nextSpeakerHint,
    auditSnapshot,
    turnPluginEntries,
    defaultSpeakerCharacterId,
    skipSpeakQuotaDeduction,
    groupChatResolveAfterSegment,
    groupChatResolveOut,
    segmentPickAudit,
  } = params
  const auditStorageStartedAt =
    auditSnapshot?.performance?.persistMs !== undefined ? performance.now() : 0
  if (!receives.length) return false
  const located = await readChunkContainingOrdinal(conversationId, turnOrdinal)
  if (!located) return false
  const { chunk, fileName: chunkName, branchPath } = located
  const idx = await readConversationIndex(conversationId)
  if (!idx) return false
  const ti = chunk.turns.findIndex((t) => t.turnOrdinal === turnOrdinal)
  if (ti < 0) return false
  const turn = chunk.turns[ti]
  const defaultSpeaker =
    defaultSpeakerCharacterId?.trim() ||
    idx.characterIds?.[0]?.trim() ||
    ''
  const segmentsWithContent = turn.segments.filter(
    (s) => (s.receives?.length ?? 0) > 0,
  )
  const lastSpeaker =
    segmentsWithContent[segmentsWithContent.length - 1]?.speakerCharacterId?.trim() ||
    null
  const speaker = speakerCharacterId.trim()
  const hintOverride =
    nextSpeakerHint?.trim() === speaker
  if (lastSpeaker && lastSpeaker === speaker && !hintOverride) return false
  const used = collectChunkEntityIds(chunk)
  const mappedReceives = mapReceivesWithShortIds(receives, used)
  const activeIdx = Math.min(
    Math.max(0, activeReceiveIndex),
    mappedReceives.length - 1,
  )
  const segmentId = allocateShortId(used)
  const newSegment: AssistantSegmentRecord = {
    id: segmentId,
    speakerCharacterId: speaker,
    receives: mappedReceives,
    activeReceiveIndex: activeIdx,
    ...(nextSpeakerHint ? { meta: { nextSpeakerHint } } : {}),
  }
  turn.segments = [...turn.segments, newSegment]
  turn.activeSegmentIndex = turn.segments.length - 1
  syncTurnSpeakerFromActiveSegment(turn)
  const groupChatSettings = idx.groupChat?.enabled
    ? normalizeGroupChatSettings(idx.groupChat)
    : null
  const characterIds = idx.characterIds ?? []
  if (groupChatSettings?.enabled && characterIds.length > 0) {
    if (!turn.groupChatTurnState) {
      turn.groupChatTurnState = initGroupChatTurnState(groupChatSettings, characterIds)
    }
    turn.groupChatTurnState = recordSegmentSpeaker(
      turn.groupChatTurnState,
      speaker,
      skipSpeakQuotaDeduction ? { skipQuotaDeduction: true } : undefined,
    )
  } else if (turn.groupChatTurnState) {
    turn.groupChatTurnState = recordSegmentSpeaker(
      turn.groupChatTurnState,
      speaker,
      skipSpeakQuotaDeduction ? { skipQuotaDeduction: true } : undefined,
    )
  }
  if (groupChatResolveAfterSegment) {
    const nextResolved = applyNextSpeakerStateToTurn(
      turn,
      groupChatResolveAfterSegment,
    )
    if (groupChatResolveOut) {
      groupChatResolveOut.nextResolved = nextResolved
    }
    attachResolvedNextSpeakerAuditToActiveSegment(
      turn,
      defaultSpeaker,
      nextResolved.groupChatAudit,
    )
  }
  const segmentIndex = turn.activeSegmentIndex
  attachSegmentPickAuditToSegment(turn, segmentIndex, segmentPickAudit)
  const receiveId = mappedReceives[activeIdx]?.id?.trim() ?? ''
  if (turnPluginEntries?.length) {
    let plugins = Array.isArray(turn.plugins) ? turn.plugins : []
    for (const entry of attachReceiveIdToTurnPluginEntries(
      turnPluginEntries,
      receiveId,
    ) ?? []) {
      plugins = mergeTurnPluginEntry(plugins, entry)
    }
    turn.plugins = plugins
  }
  const storagePath = chunkStorageRelativePath(branchPath, chunkName)
  await writeChunkFile(conversationId, storagePath, chunk)
  const t = nowIso()
  await updateConversationIndexAndList(conversationId, (fresh) => {
    fresh.updatedAt = t
    return fresh
  })
  if (auditSnapshot !== undefined) {
    finalizeAuditPersistDiskMs(auditSnapshot, auditStorageStartedAt)
    const idxForAudit = await readConversationIndex(conversationId)
    const snapshot = withGroupChatAuditSnapshot(
      auditSnapshot,
      speaker,
      segmentPickAudit,
      groupChatResolveOut?.nextResolved,
    )
    await appendChatAuditEntry(conversationId, idxForAudit, {
      chunkName: storagePath,
      turnId: turn.turnId,
      turnOrdinal,
      segmentIndex,
      receiveId,
      snapshot: snapshot ?? auditSnapshot,
    })
  }
  scheduleMemoryIndexUpsert(conversationId, turn, chunkName, branchPath)
  return true
}

/** 仅合并 turn.plugins 条目（如 receive 补写）；可选同步 active receive 正文 */
export async function mergeTurnPluginEntriesAtOrdinal(
  conversationId: string,
  turnOrdinal: number,
  entries: TurnPluginEntry[],
  options?: {
    receiveContent?: { receiveId: string; content: string }
  },
): Promise<'ok' | 'not_found'> {
  if (!entries.length && !options?.receiveContent) return 'not_found'
  const located = await readChunkContainingOrdinal(conversationId, turnOrdinal)
  if (!located) return 'not_found'
  const { chunk, fileName: chunkName, branchPath } = located
  const turn = chunk.turns.find((t) => t.turnOrdinal === turnOrdinal)
  if (!turn) return 'not_found'

  let plugins = Array.isArray(turn.plugins) ? turn.plugins : []
  for (const entry of entries) {
    plugins = mergeTurnPluginEntry(plugins, entry)
  }
  turn.plugins = plugins

  const sync = options?.receiveContent
  if (sync?.receiveId && typeof sync.content === 'string') {
    const receiveId = sync.receiveId.trim()
    const hit = findReceiveInTurn(turn, receiveId)
    if (!hit) return 'not_found'
    hit.receive.content = sync.content
  }

  await writeChunkFile(
    conversationId,
    chunkStorageRelativePath(branchPath, chunkName),
    chunk,
  )
  await updateConversationIndexAndList(conversationId, (fresh) => {
    fresh.updatedAt = nowIso()
    return fresh
  })
  return 'ok'
}

/** 更新任意 chunk 中某轮：用户正文 + 助手 receives（全量替换） */
export async function updateTurnContentInTailChunk(
  conversationId: string,
  turnOrdinal: number,
  userText: string,
  receives: TurnReceive[],
  activeReceiveIndex: number,
  auditSnapshot?: ChatAuditSnapshotInput,
  turnPluginEntries?: TurnPluginEntry[],
  turnPlugins?: unknown[],
): Promise<boolean> {
  if (!receives.length) return false
  const auditStorageStartedAt =
    auditSnapshot?.performance?.persistMs !== undefined ? performance.now() : 0
  const located = await readChunkContainingOrdinal(conversationId, turnOrdinal)
  if (!located) return false
  const { chunk, fileName: chunkName, branchPath } = located
  const idx = await readConversationIndex(conversationId)
  if (!idx) return false
  const ti = chunk.turns.findIndex((t) => t.turnOrdinal === turnOrdinal)
  if (ti < 0) return false
  const turn = chunk.turns[ti]
  const turnId = turn.turnId
  const used = collectChunkEntityIds(chunk)
  applyTurnContentUpdate(turn, used, userText, receives, activeReceiveIndex)
  if (turnPlugins !== undefined) {
    turn.plugins = turnPlugins
  } else if (turnPluginEntries?.length) {
    let plugins = Array.isArray(turn.plugins) ? turn.plugins : []
    for (const entry of turnPluginEntries) {
      plugins = mergeTurnPluginEntry(plugins, entry)
    }
    turn.plugins = plugins
  }
  const defaultSpeaker = idx.characterIds?.[0]?.trim() ?? ''
  const segmentIndex = getActiveSegmentIndex(turn)
  const segmentSpeaker =
    getActiveSegment(turn, defaultSpeaker)?.speakerCharacterId?.trim() || defaultSpeaker
  const segmentPick = turn.segments[segmentIndex]?.meta?.segmentPickAudit
  const receiveId = auditReceiveIdForSegment(turn, segmentIndex)
  const storagePath = chunkStorageRelativePath(branchPath, chunkName)
  await writeChunkFile(conversationId, storagePath, chunk)
  const t = nowIso()
  await updateConversationIndexAndList(conversationId, (fresh) => {
    fresh.updatedAt = t
    return fresh
  })
  if (auditSnapshot !== undefined) {
    finalizeAuditPersistDiskMs(auditSnapshot, auditStorageStartedAt)
    const idxForAudit = await readConversationIndex(conversationId)
    const snapshot = withGroupChatAuditSnapshot(
      auditSnapshot,
      segmentSpeaker,
      segmentPick,
      undefined,
    )
    await appendChatAuditEntry(conversationId, idxForAudit, {
      chunkName: storagePath,
      turnId,
      turnOrdinal,
      segmentIndex,
      receiveId,
      snapshot: snapshot ?? auditSnapshot,
    })
  }
  scheduleMemoryIndexUpsert(conversationId, turn, chunkName, branchPath)
  return true
}

/** 更新某 turn 指定 segment 的 receives（regenerate/swipe 仅当前 segment） */
export async function updateTurnSegmentInTailChunk(
  conversationId: string,
  turnOrdinal: number,
  segmentIndex: number,
  userText: string,
  receives: TurnReceive[],
  activeReceiveIndex: number,
  defaultSpeakerCharacterId: string,
  auditSnapshot?: ChatAuditSnapshotInput,
  turnPluginEntries?: TurnPluginEntry[],
  turnPlugins?: unknown[],
  nextSpeakerHint?: string,
  groupChatOpts?: {
    groupChatResolveAfterSegment?: GroupChatResolveParams
    groupChatResolveOut?: { nextResolved?: ResolveNextSpeakerResult }
    segmentPickAudit?: GroupChatSpeakerAudit
  },
): Promise<boolean> {
  if (!receives.length) return false
  const auditStorageStartedAt =
    auditSnapshot?.performance?.persistMs !== undefined ? performance.now() : 0
  const located = await readChunkContainingOrdinal(conversationId, turnOrdinal)
  if (!located) return false
  const { chunk, fileName: chunkName, branchPath } = located
  const idx = await readConversationIndex(conversationId)
  if (!idx) return false
  const ti = chunk.turns.findIndex((t) => t.turnOrdinal === turnOrdinal)
  if (ti < 0) return false
  const turn = chunk.turns[ti]
  const turnId = turn.turnId
  const used = collectChunkEntityIds(chunk)
  const hadLaterSegments = turn.segments.length > segmentIndex + 1
  applyTurnSegmentContentUpdate(
    turn,
    used,
    segmentIndex,
    userText,
    receives,
    activeReceiveIndex,
    defaultSpeakerCharacterId,
    nextSpeakerHint,
  )
  if (hadLaterSegments) {
    turn.segments = turn.segments.slice(0, segmentIndex + 1)
    turn.activeSegmentIndex = segmentIndex
    syncTurnSpeakerFromActiveSegment(turn)
    await removeChatAuditEntriesAfterSegment(conversationId, turnId, segmentIndex)
    const resolveParams = groupChatOpts?.groupChatResolveAfterSegment
    const groupChatSettings = normalizeGroupChatSettings(
      resolveParams?.groupChat ?? idx.groupChat,
    )
    if (groupChatSettings.enabled) {
      const charIds =
        resolveParams?.characterIds?.length
          ? resolveParams.characterIds
          : resolvedCharacterIds(idx)
      turn.groupChatTurnState = rebuildGroupChatTurnStateFromTurn(
        turn,
        groupChatSettings,
        charIds,
        defaultSpeakerCharacterId,
      )
    }
  }
  if (turnPlugins !== undefined) {
    turn.plugins = turnPlugins
  } else if (turnPluginEntries?.length) {
    let plugins = Array.isArray(turn.plugins) ? turn.plugins : []
    for (const entry of turnPluginEntries) {
      plugins = mergeTurnPluginEntry(plugins, entry)
    }
    turn.plugins = plugins
  }
  const segmentSpeaker =
    getActiveSegment(turn, defaultSpeakerCharacterId)?.speakerCharacterId?.trim() ||
    defaultSpeakerCharacterId.trim()
  if (groupChatOpts?.groupChatResolveAfterSegment) {
    const nextResolved = applyNextSpeakerStateToTurn(
      turn,
      groupChatOpts.groupChatResolveAfterSegment,
    )
    if (groupChatOpts.groupChatResolveOut) {
      groupChatOpts.groupChatResolveOut.nextResolved = nextResolved
    }
    attachResolvedNextSpeakerAuditToActiveSegment(
      turn,
      defaultSpeakerCharacterId,
      nextResolved.groupChatAudit,
    )
  }
  attachSegmentPickAuditToSegment(turn, segmentIndex, groupChatOpts?.segmentPickAudit)
  const receiveId = auditReceiveIdForSegment(turn, segmentIndex)
  const storagePath = chunkStorageRelativePath(branchPath, chunkName)
  await writeChunkFile(conversationId, storagePath, chunk)
  const t = nowIso()
  await updateConversationIndexAndList(conversationId, (fresh) => {
    fresh.updatedAt = t
    return fresh
  })
  if (auditSnapshot !== undefined) {
    finalizeAuditPersistDiskMs(auditSnapshot, auditStorageStartedAt)
    const idxForAudit = await readConversationIndex(conversationId)
    const snapshot = withGroupChatAuditSnapshot(
      auditSnapshot,
      segmentSpeaker,
      groupChatOpts?.segmentPickAudit,
      groupChatOpts?.groupChatResolveOut?.nextResolved,
    )
    await appendChatAuditEntry(conversationId, idxForAudit, {
      chunkName: storagePath,
      turnId,
      turnOrdinal,
      segmentIndex,
      receiveId,
      snapshot: snapshot ?? auditSnapshot,
    })
  }
  scheduleMemoryIndexUpsert(conversationId, turn, chunkName, branchPath)
  return true
}
