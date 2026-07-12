import { allocateShortId } from './short-id.js'
import { mergeTurnPluginEntry, attachReceiveIdToTurnPluginEntries } from './turn-plugin-utils.js'
import type { TurnPluginEntry } from './plugin-types.js'
import {
  mergeAuthorsNote,
  seedAuthorsNoteFromTemplate,
  type AuthorsNotePatch,
  type AuthorsNoteSettings,
} from './authors-note-settings.js'
import { mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getChatsRoot } from './config.js'
import { normalizeBranchPath, chunkStorageRelativePath } from './chunk-path.js'
import { isValidConversationId } from './conversation-id.js'
import type { ResolvedFeatureAudit } from './feature-binding-resolve.js'
import type {
  ChatAuditSnapshotInput,
  PersistTimingMs,
} from './chat-audit-types.js'
import {
  appendChatAuditEntry,
  DEFAULT_AUDIT_DEBUG_MAX,
  removeChatAuditEntriesAfterSegment,
  removeChatAuditEntriesByTurnId,
  trimChatAuditEntries,
} from './chat-audit-file.js'
import {
  lorebookSettingsOverrideFromEffective,
  normalizeLorebookSettings,
  resolveLorebookSettings,
  type LorebookSettings,
} from './lorebook-settings.js'
import {
  historySettingsOverrideFromEffective,
  normalizeHistorySettings,
  resolveHistorySettings,
  type HistorySettings,
} from './history-settings.js'
import {
  memorySettingsOverrideFromEffective,
  normalizeMemorySettings,
  resolveMemorySettings,
  type MemorySettings,
} from './memory-settings.js'
import {
  budgetTrimSettingsOverrideFromEffective,
  normalizeBudgetTrimSettings,
  resolveBudgetTrimSettings,
  type BudgetTrimSettingsOverride,
} from './budget-trim-settings.js'
import {
  chatBindingOverrideFromEffective,
  conversationChatBindingSnapshot,
  conversationEmbeddingOverrideFromEffective,
  hasConversationChatBinding,
  hasConversationEmbeddingApiOverride,
  mergePresetWithChatBinding,
  parseConversationChatBinding,
  parseConversationEmbeddingApiOverride,
  readConversationChatBinding,
  resolveConversationEmbeddingModelSettings,
  type ConversationChatBinding,
  type ConversationEmbeddingApiSettingsOverride,
} from './conversation-api-settings.js'
import { readApiSettingsFromFile } from './api-settings-file.js'
import {
  readGlobalBudgetTrimSettings,
  readGlobalDefaultAuthorsNote,
  readGlobalHistorySettings,
  readGlobalLorebookSettings,
  readGlobalMemorySettings,
  readGlobalChunkSettings,
} from './user-preferences-file.js'
import {
  isConversationMemoryEmbedActive,
  isTurnEligibleForMemoryEmbed,
  scheduleMemoryIndexDelete,
  scheduleMemoryIndexUpsert,
  sealChunkMemorySegment,
  wipeConversationMemoryIndex,
} from './memory-index.js'
import {
  buildFirstChunkDescriptor,
  chunkFileNameForRange,
  chunkIdFromFileName,
  invalidateChunkIndexSyncCache,
  isTurnOrdinalOffActivePath,
  normalizeTailChunkBasename,
  ordinalRangeForNewChunk,
  prepareTailChunkForAppend,
  readChunkContainingOrdinal,
  readChunkFile,
  readConversationActiveBranchPath,
  resolveActivePathConversationStats,
} from './chunk-chain.js'
import {
  CONVERSATION_BATCH_MAX_TURNS,
  type TurnContentPatchInput,
} from './turn-patch-body.js'
import {
  findReceiveInTurn,
  getActiveSegment,
  getActiveSegmentIndex,
  getSegmentAtIndex,
  syncTurnSpeakerFromActiveSegment,
  recordSegmentSpeaker,
  initGroupChatTurnState,
  normalizeGroupChatSettings,
  applyNextSpeakerStateToTurn,
  attachResolvedNextSpeakerAuditToActiveSegment,
  attachSegmentPickAuditToSegment,
  buildGroupChatAuditSnapshot,
  rebuildGroupChatTurnStateFromTurn,
  type AssistantSegmentRecord,
  type GroupChatSpeakerAudit,
  type GroupChatResolveParams,
  type GroupChatSettings,
  type GroupChatTurnState,
  type ResolveNextSpeakerResult,
  mergeGroupChatSettings,
} from './group-chat-turn.js'

export type {
  AssistantSegmentRecord,
  GroupChatSettings,
  GroupChatTurnState,
} from './group-chat-turn.js'

function finalizeAuditPersistDiskMs(
  snapshot: ChatAuditSnapshotInput | undefined,
  storageStartedAt: number,
): void {
  const persistMs = snapshot?.performance?.persistMs as PersistTimingMs | undefined
  if (!persistMs || storageStartedAt <= 0) return
  const diskAndAudit = Math.round(performance.now() - storageStartedAt)
  persistMs.diskAndAudit = diskAndAudit
  const regex = persistMs.regex
  persistMs.total =
    typeof regex === 'number' ? regex + diskAndAudit : diskAndAudit
}


function chatListFile(): string {
  return path.join(getChatsRoot(), 'chat.index.json')
}

export interface ChatListEntry {
  conversationId: string
  title: string
  updatedAt: string
  /** 用户 persona 卡 id；组装时注入 `<user>` 块，宏仍用 userName 快照 */
  userCharacterId?: string
  /** 会话绑定的多张角色卡 id，顺序即主槽 {{char}}、次槽 {{char2}}… */
  characterIds?: string[]
  /** 对话级提示词预设 id；缺省则客户端用全局激活预设 */
  promptPresetId?: string | null
  /** 世界书 id 列表（占位） */
  lorebookIds?: string[]
  activeBranchPath?: string | null
  /** 宏 {{user}} 快照；来自会话根 index.json */
  userName?: string
  /** 与 characterIds 同序；卡已删时为「已删除」 */
  characterNames?: string[]
  /** 绑定卡 + user persona 的 tags 去重合并，供列表快查 */
  searchTags?: string[]
  /** 当前 active 分支路径上的总轮数（含 fork 前缀） */
  activeTurnCount?: number
  /** active 路径末轮 createdAt（最近发消息时刻）；无轮次则无此字段 */
  lastChatAt?: string
}

export interface ChatListFile {
  schemaVersion: 1
  conversations: ChatListEntry[]
}

export interface ConversationIndex {
  schemaVersion: 1
  conversationId: string
  title: string
  /** 多卡绑定 */
  characterIds?: string[]
  createdAt: string
  updatedAt: string
  headChunkFile: string | null
  tailChunkFile: string | null
  /** 当前选中分支（会话根相对；主路径 "" 或省略） */
  activeBranchPath?: string | null
  apiPreset?: Record<string, unknown>
  backupSettings?: { everyNRounds: number; maxKeptBackups: number }
  branches?: unknown[]
  /**
   * 调试：chat-audit.json（`auditDebug`）。
   * `enabled === false` 或 `maxStored < 1` 时不写入新审计条目。
   */
  auditDebug?: { enabled: boolean; maxStored: number }
  /**
   * 对话级提示词预设（`data/{user}/prompts/` 内预设 `id`）。
   * 缺省或未写入：客户端使用全局「当前激活预设」。
   */
  promptPresetId?: string | null
  /**
   * 对话绑定的世界书 / lorebook id 列表（占位；检索与注入未接前可恒为空数组）。
   */
  lorebookIds?: string[]
  /** 资料库递归稀疏覆盖（未写字段继承全局 user-preferences） */
  lorebookSettings?: Partial<LorebookSettings>
  /** 历史轮数稀疏覆盖（未写字段继承全局 user-preferences） */
  historySettings?: Partial<HistorySettings>
  /** 对话记忆稀疏覆盖（未写字段继承全局 user-preferences） */
  memorySettings?: Partial<MemorySettings>
  /** §14.4.1 预算裁切稀疏覆盖（未写字段继承全局 user-preferences） */
  budgetTrimSettings?: BudgetTrimSettingsOverride
  /**
   * 对话级 Embedding 模型参数稀疏覆盖（连接仍用全局 embeddingApi）。
   */
  embeddingApiSettings?: ConversationEmbeddingApiSettingsOverride
  /**
   * 远期记忆向量索引所用 embedding 模型（与全局 embeddingApi.embeddingModel 对齐）。
   * 未写入表示尚未按当前模型完成索引或需重建。
   */
  memoryEmbeddingModel?: string | null
  /** 与 memoryEmbeddingModel 一并记录；null 表示索引时未指定 dimensions */
  memoryEmbeddingDimensions?: number | null
  /** 重建记忆索引时使用的 Hybrid FTS 分词 profile */
  memoryHybridFtsProfile?: string | null
  /**
   * 对话内用户展示名（宏 `{{user}}`）；缺省由服务端用默认「用户」。
   */
  userName?: string
  /**
   * 用户 persona 卡 id：UI 回显 + 组装注入 persona。卡删除后仅保留 userName 快照与宏。
   */
  userCharacterId?: string
  /** 会话级 Author's Note（作者注） */
  authorsNote?: AuthorsNoteSettings
  /**
   * 会话级插件配置。键为 pluginId，值为插件自定义 JSON；
   * 宿主只做对象校验与 PATCH 浅合并，不解释业务字段。
   */
  pluginSettings?: Record<string, Record<string, unknown>>
  /** persist retro 待重试的 turnOrdinal（写盘失败时写入） */
  retroPersistPending?: number[]
  /** ST 式会话局部宏变量（`{{setvar}}` / `{{getvar}}`） */
  macroLocalVars?: Record<string, string>
  /** 已注册分支的 fork turnId 索引（加速 DELETE turn 校验；repair 可重建） */
  branchForkTurnIds?: string[]
  /** 群聊开关与接续策略（§35） */
  groupChat?: GroupChatSettings
}

export interface TurnReceive {
  id: string
  content: string
  /** 思维链 / reasoning（与上游 reasoning_content 等对应） */
  reasoning?: string
  runtime?: Record<string, unknown>
}

/** 助手 receive 运行时元数据（模型、耗时、组装 token 估算等） */
export function buildReceiveRuntime(opts: {
  model?: string
  durationMs?: number
  /** 发往模型的 messages 估算（tiktoken） */
  estimatedTokens?: number
  /** 上游 usage.completion_tokens，缺省时由落盘逻辑 tiktoken 估算助手正文 */
  completionTokens?: number
  /** 出站 chat 等功能键解析结果（审计用，不含密钥） */
  resolvedFeature?: ResolvedFeatureAudit
}): Record<string, unknown> | undefined {
  const runtime: Record<string, unknown> = {}
  if (opts.model) runtime.model = opts.model
  if (typeof opts.durationMs === 'number' && opts.durationMs > 0) {
    runtime.durationMs = Math.round(opts.durationMs)
  }
  if (
    typeof opts.estimatedTokens === 'number' &&
    Number.isFinite(opts.estimatedTokens) &&
    opts.estimatedTokens > 0
  ) {
    runtime.estimatedTokens = Math.round(opts.estimatedTokens)
  }
  if (
    typeof opts.completionTokens === 'number' &&
    Number.isFinite(opts.completionTokens) &&
    opts.completionTokens > 0
  ) {
    runtime.completionTokens = Math.round(opts.completionTokens)
  }
  if (opts.resolvedFeature) {
    runtime.resolvedFeature = opts.resolvedFeature
  }
  return Object.keys(runtime).length > 0 ? runtime : undefined
}

export interface TurnRecord {
  turnId: string
  turnOrdinal: number
  /** 用户发消息 / 该轮落盘时刻（ISO8601）；旧 chunk 可无此字段 */
  createdAt?: string
  send: { userText: string }
  plugins: unknown[]
  /** 群聊：同 turn 多 assistant segment（§35）；单 bot 亦 ≥1 段 */
  segments: AssistantSegmentRecord[]
  activeSegmentIndex: number
  /** 来自 /@ 的待发言 characterId 队列 */
  speakerQueue?: string[]
  /** 群聊 G ID 内 per-bot 额度与发言计数（G3） */
  groupChatTurnState?: GroupChatTurnState
  /** 当前 active segment 的 speaker */
  speakerCharacterId?: string
}

/** 收集 chunk 内已有 turnId / receive.id，供短 id 分配去重 */
export function collectChunkEntityIds(chunk: ChunkFile | null): Set<string> {
  const used = new Set<string>()
  if (!chunk?.turns?.length) return used
  for (const t of chunk.turns) {
    const tid = typeof t.turnId === 'string' ? t.turnId.trim() : ''
    if (tid) used.add(tid)
    for (const s of t.segments ?? []) {
      const sid = typeof s.id === 'string' ? s.id.trim() : ''
      if (sid) used.add(sid)
      for (const r of s.receives ?? []) {
        const rid = typeof r.id === 'string' ? r.id.trim() : ''
        if (rid) used.add(rid)
      }
    }
  }
  return used
}

function mapReceivesWithShortIds(
  receives: TurnReceive[],
  used: Set<string>,
): TurnReceive[] {
  return receives.map((r) => {
    const rec: TurnReceive = {
      id: r.id?.trim() ? r.id.trim() : allocateShortId(used),
      content: r.content,
    }
    if (typeof r.reasoning === 'string' && r.reasoning.length > 0) {
      rec.reasoning = r.reasoning
    }
    if (r.runtime && typeof r.runtime === 'object') {
      rec.runtime = r.runtime
    }
    return rec
  })
}

function releaseTurnEntityIds(turn: TurnRecord, used: Set<string>): void {
  for (const s of turn.segments ?? []) {
    const sid = typeof s.id === 'string' ? s.id.trim() : ''
    if (sid) used.delete(sid)
    for (const r of s.receives ?? []) {
      const rid = typeof r.id === 'string' ? r.id.trim() : ''
      if (rid) used.delete(rid)
    }
  }
  const tid = typeof turn.turnId === 'string' ? turn.turnId.trim() : ''
  if (tid) used.delete(tid)
}

function buildFirstSegmentOnTurn(
  turn: TurnRecord,
  used: Set<string>,
  params: {
    speakerCharacterId: string
    receives: TurnReceive[]
    activeReceiveIndex: number
    nextSpeakerHint?: string
  },
): void {
  const mappedReceives = mapReceivesWithShortIds(params.receives, used)
  const activeIdx = Math.min(
    Math.max(0, params.activeReceiveIndex),
    Math.max(0, mappedReceives.length - 1),
  )
  const segmentId = allocateShortId(used)
  const speaker = params.speakerCharacterId.trim()
  turn.segments = [
    {
      id: segmentId,
      speakerCharacterId: speaker,
      receives: mappedReceives,
      activeReceiveIndex: activeIdx,
      ...(params.nextSpeakerHint
        ? { meta: { nextSpeakerHint: params.nextSpeakerHint } }
        : {}),
    },
  ]
  turn.activeSegmentIndex = 0
  turn.speakerCharacterId = speaker
  syncTurnSpeakerFromActiveSegment(turn)
}

/** 在内存中更新单轮正文与 receives（调用方维护 chunk 级 used 集合） */
function applyTurnContentUpdate(
  turn: TurnRecord,
  used: Set<string>,
  userText: string,
  receives: TurnReceive[],
  activeReceiveIndex: number,
  segmentIndex?: number,
): void {
  if (!receives.length) return
  releaseTurnEntityIds(turn, used)
  const segIdx =
    typeof segmentIndex === 'number' && Number.isInteger(segmentIndex)
      ? segmentIndex
      : getActiveSegmentIndex(turn)
  const activeSeg = turn.segments[segIdx]
  if (!activeSeg) return
  const prevReceives = activeSeg.receives ?? []
  const mappedReceives = mapReceivesWithShortIds(receives, used).map((rec) => {
    const rid = typeof rec.id === 'string' ? rec.id.trim() : ''
    const prev = prevReceives.find(
      (p) => typeof p.id === 'string' && p.id.trim() === rid,
    )
    if (!prev?.runtime || typeof prev.runtime !== 'object') return rec
    return {
      ...rec,
      runtime: {
        ...(prev.runtime as Record<string, unknown>),
        ...(rec.runtime ?? {}),
      },
    }
  })
  const activeIdx = Math.min(
    Math.max(0, activeReceiveIndex),
    mappedReceives.length - 1,
  )
  const prevActiveSegIdx = getActiveSegmentIndex(turn)
  turn.send = { userText }
  activeSeg.receives = mappedReceives
  activeSeg.activeReceiveIndex = activeIdx
  if (segIdx === prevActiveSegIdx) {
    syncTurnSpeakerFromActiveSegment(turn)
  }
}

/** 更新指定 segment 的 receives（regenerate/swipe 仅当前 segment） */
function applyTurnSegmentContentUpdate(
  turn: TurnRecord,
  used: Set<string>,
  segmentIndex: number,
  userText: string,
  receives: TurnReceive[],
  activeReceiveIndex: number,
  defaultSpeakerCharacterId: string,
  nextSpeakerHint?: string,
): void {
  if (!receives.length) return
  const seg = turn.segments[segmentIndex]
  if (!seg) return
  for (const r of seg.receives ?? []) {
    const rid = typeof r.id === 'string' ? r.id.trim() : ''
    if (rid) used.delete(rid)
  }
  const prevReceives = seg.receives ?? []
  seg.receives = mapReceivesWithShortIds(receives, used).map((rec) => {
    const rid = typeof rec.id === 'string' ? rec.id.trim() : ''
    const prev = prevReceives.find(
      (p) => typeof p.id === 'string' && p.id.trim() === rid,
    )
    if (!prev?.runtime || typeof prev.runtime !== 'object') return rec
    return {
      ...rec,
      runtime: {
        ...(prev.runtime as Record<string, unknown>),
        ...(rec.runtime ?? {}),
      },
    }
  })
  seg.activeReceiveIndex = Math.min(
    Math.max(0, activeReceiveIndex),
    seg.receives.length - 1,
  )
  if (nextSpeakerHint) {
    seg.meta = { ...(seg.meta ?? {}), nextSpeakerHint }
  }
  turn.activeSegmentIndex = segmentIndex
  turn.send = { userText }
  syncTurnSpeakerFromActiveSegment(turn)
}

export interface BatchTurnUpdateResult {
  ok: number
  failed: { turnOrdinal: number; error: string }[]
  /** memory 开启且 API 可用时，实际入队 re-embed 的轮次数 */
  memoryEmbedsQueued: number
  /** 跨 chunk 写盘时若中途失败并已回滚已写 chunk */
  rolledBack?: boolean
}

function cloneChunkFile(chunk: ChunkFile): ChunkFile {
  return structuredClone(chunk)
}

/**
 * 批量更新多轮：每个 chunk 至多 read+write 一次，index 至多写一次。
 * 先完成全部 chunk 读取与内存变更，再统一写入；跨 chunk 写失败时回滚已成功写入的 chunk。
 */
export async function batchUpdateConversationTurns(
  conversationId: string,
  patches: TurnContentPatchInput[],
): Promise<BatchTurnUpdateResult> {
  if (!patches.length) return { ok: 0, failed: [], memoryEmbedsQueued: 0 }
  if (patches.length > CONVERSATION_BATCH_MAX_TURNS) {
    throw new Error('turns_batch_too_large')
  }

  const ordinals = patches.map((p) => p.turnOrdinal)
  const idx = await readConversationIndex(conversationId)
  if (!idx) {
    return {
      ok: 0,
      failed: patches.map((p) => ({
        turnOrdinal: p.turnOrdinal,
        error: 'conversation_not_found',
      })),
      memoryEmbedsQueued: 0,
    }
  }

  type Located = {
    patch: TurnContentPatchInput
    fileName: string
    branchPath: string
    storagePath: string
    turn: TurnRecord
  }
  const located: Located[] = []
  const failed: { turnOrdinal: number; error: string }[] = []

  for (const patch of patches) {
    const loc = await readChunkContainingOrdinal(conversationId, patch.turnOrdinal)
    if (!loc) {
      const offActive = await isTurnOrdinalOffActivePath(
        conversationId,
        patch.turnOrdinal,
      )
      failed.push({
        turnOrdinal: patch.turnOrdinal,
        error: offActive ? 'turn_not_on_active_path' : 'turn_chunk_not_found',
      })
      continue
    }
    const turn = loc.chunk.turns.find((t) => t.turnOrdinal === patch.turnOrdinal)
    if (!turn) {
      failed.push({ turnOrdinal: patch.turnOrdinal, error: 'turn_chunk_not_found' })
      continue
    }
    located.push({
      patch,
      fileName: loc.fileName,
      branchPath: loc.branchPath,
      storagePath: chunkStorageRelativePath(loc.branchPath, loc.fileName),
      turn,
    })
  }

  const byStorage = new Map<string, Located[]>()
  for (const item of located) {
    const list = byStorage.get(item.storagePath) ?? []
    list.push(item)
    byStorage.set(item.storagePath, list)
  }

  type PendingWrite = {
    storagePath: string
    chunk: ChunkFile
    items: Located[]
    pendingUpserts: { turn: TurnRecord; chunkName: string; branchPath: string }[]
  }
  const pendingWrites: PendingWrite[] = []

  for (const [storagePath, items] of byStorage) {
    const chunk = await readChunkFile(conversationId, storagePath)
    if (!chunk) {
      for (const { patch } of items) {
        failed.push({ turnOrdinal: patch.turnOrdinal, error: 'chunk_read_failed' })
      }
      continue
    }
    const used = collectChunkEntityIds(chunk)
    const first = items[0]!
    const pendingUpserts: { turn: TurnRecord; chunkName: string; branchPath: string }[] = []
    let chunkChanged = false
    for (const { patch } of items) {
      const turn = chunk.turns.find((t) => t.turnOrdinal === patch.turnOrdinal)
      if (!turn) {
        failed.push({ turnOrdinal: patch.turnOrdinal, error: 'turn_chunk_not_found' })
        continue
      }
      applyTurnContentUpdate(
        turn,
        used,
        patch.userText,
        patch.receives,
        patch.activeReceiveIndex,
        patch.segmentIndex ?? patch.activeSegmentIndex,
      )
      pendingUpserts.push({
        turn,
        chunkName: first.fileName,
        branchPath: first.branchPath,
      })
      chunkChanged = true
    }
    if (chunkChanged) {
      pendingWrites.push({ storagePath, chunk, items, pendingUpserts })
    }
  }

  const memoryUpserts: { turn: TurnRecord; chunkName: string; branchPath: string }[] = []
  const touchedBranchPaths = new Set<string>()
  let ok = 0
  let rolledBack = false
  const memoryEmbedActive = await isConversationMemoryEmbedActive(conversationId)

  const snapshots = new Map<string, ChunkFile>()
  for (const pending of pendingWrites) {
    snapshots.set(pending.storagePath, cloneChunkFile(pending.chunk))
  }

  const writtenPaths: string[] = []
  let writeAborted = false

  for (const pending of pendingWrites) {
    if (writeAborted) {
      for (const { patch } of pending.items) {
        failed.push({ turnOrdinal: patch.turnOrdinal, error: 'chunk_write_failed' })
      }
      continue
    }
    try {
      await writeChunkFile(conversationId, pending.storagePath, pending.chunk)
      writtenPaths.push(pending.storagePath)
      touchedBranchPaths.add(normalizeBranchPath(pending.pendingUpserts[0]!.branchPath))
      memoryUpserts.push(...pending.pendingUpserts)
      ok += pending.pendingUpserts.length
    } catch {
      writeAborted = true
      rolledBack = writtenPaths.length > 0
      for (const writtenPath of writtenPaths) {
        const snap = snapshots.get(writtenPath)
        if (snap) {
          await writeChunkFile(conversationId, writtenPath, snap).catch(() => {})
        }
      }
      ok = 0
      memoryUpserts.length = 0
      touchedBranchPaths.clear()
      for (const { patch } of pending.items) {
        failed.push({ turnOrdinal: patch.turnOrdinal, error: 'chunk_write_failed' })
      }
    }
  }

  let memoryEmbedsQueued = 0
  if (ok > 0) {
    const t = nowIso()
    idx.updatedAt = t
    await writeConversationIndex(conversationId, idx)
    await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
    for (const branchPath of touchedBranchPaths) {
      if (!branchPath) continue
      const branchIdx = await readBranchConversationIndex(conversationId, branchPath)
      if (!branchIdx) continue
      branchIdx.updatedAt = t
      await writeBranchConversationIndex(conversationId, branchPath, branchIdx)
    }
    if (memoryEmbedActive) {
      for (const { turn, chunkName, branchPath } of memoryUpserts) {
        if (!isTurnEligibleForMemoryEmbed(turn)) continue
        scheduleMemoryIndexUpsert(conversationId, turn, chunkName, branchPath)
        memoryEmbedsQueued += 1
      }
    }
  }

  return {
    ok,
    failed,
    memoryEmbedsQueued,
    ...(rolledBack ? { rolledBack: true } : {}),
  }
}

/** 解析会话绑定的角色卡 id（顺序即 {{char}}、{{char2}}…） */
export function resolvedCharacterIds(
  idx: Pick<ConversationIndex, 'characterIds'>,
): string[] {
  if (!Array.isArray(idx.characterIds)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of idx.characterIds) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** 解析会话绑定的资料库 id 列表 */
export function resolvedLorebookIds(
  idx: Pick<ConversationIndex, 'lorebookIds'>,
): string[] {
  if (!Array.isArray(idx.lorebookIds)) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of idx.lorebookIds) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
  }
  return out
}

/** 写盘前规范化 characterIds */
export function syncConversationCharacterFields(
  idx: ConversationIndex,
): ConversationIndex {
  const ids = resolvedCharacterIds(idx)
  return {
    ...idx,
    characterIds: ids.length > 0 ? ids : undefined,
  }
}

export function chatListEntryFromIndex(idx: ConversationIndex): ChatListEntry {
  const ids = resolvedCharacterIds(idx)
  const lb = idx.lorebookIds
  const lorebookIds = Array.isArray(lb)
    ? lb.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []
  return {
    conversationId: idx.conversationId,
    title: idx.title,
    updatedAt: idx.updatedAt,
    ...(typeof idx.userCharacterId === 'string' && idx.userCharacterId.trim()
      ? { userCharacterId: idx.userCharacterId.trim() }
      : {}),
    ...(typeof idx.userName === 'string' && idx.userName.trim()
      ? { userName: idx.userName.trim() }
      : {}),
    characterIds: ids.length > 0 ? ids : undefined,
    ...(typeof idx.promptPresetId === 'string' && idx.promptPresetId.trim()
      ? { promptPresetId: idx.promptPresetId.trim() }
      : {}),
    ...(lorebookIds.length > 0 ? { lorebookIds } : {}),
    ...(function activeBranchListField():
      | { activeBranchPath: string }
      | { activeBranchPath: null }
      | Record<string, never> {
      if (idx.activeBranchPath === null) return { activeBranchPath: null }
      if (typeof idx.activeBranchPath !== 'string' || !idx.activeBranchPath.trim()) {
        return {}
      }
      try {
        return { activeBranchPath: normalizeBranchPath(idx.activeBranchPath) }
      } catch {
        return {}
      }
    })(),
  }
}

export async function updateConversationUserCharacterId(
  conversationId: string,
  userCharacterId: string | null,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  if (
    userCharacterId === null ||
    (typeof userCharacterId === 'string' && !userCharacterId.trim())
  ) {
    delete next.userCharacterId
  } else if (typeof userCharacterId === 'string') {
    next.userCharacterId = userCharacterId.trim()
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

export async function updateConversationUserName(
  conversationId: string,
  userName: string | null,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  if (userName === null || (typeof userName === 'string' && !userName.trim())) {
    delete next.userName
  } else if (typeof userName === 'string') {
    next.userName = userName.trim()
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

export async function updateConversationCharacterBindings(
  conversationId: string,
  characterIds: string[],
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of characterIds) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    cleaned.push(id)
  }
  const t = nowIso()
  const next: ConversationIndex = {
    ...idx,
    characterIds: cleaned,
    updatedAt: t,
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 对话级提示词预设：传 `null` 或空字符串则移除字段（回退全局预设） */
export async function updateConversationPromptPresetId(
  conversationId: string,
  promptPresetId: string | null,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  const trimmed =
    typeof promptPresetId === 'string' ? promptPresetId.trim() : ''
  if (!trimmed) {
    delete next.promptPresetId
  } else {
    next.promptPresetId = trimmed
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v)
}

/** 读取会话级某插件 settings；缺省返回空对象 */
export function readConversationPluginSettings(
  idx: ConversationIndex,
  pluginId: string,
): Record<string, unknown> {
  const id = pluginId.trim()
  if (!id) return {}
  const bag = idx.pluginSettings?.[id]
  return isPlainObject(bag) ? { ...bag } : {}
}

/**
 * 会话级插件 settings 浅合并；`partial` 中值为 `null` 的键将被删除。
 */
export function mergePluginSettingsPartial(
  prev: Record<string, unknown>,
  partial: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...prev }
  for (const [k, v] of Object.entries(partial)) {
    if (v === null) delete next[k]
    else next[k] = v
  }
  return next
}

/**
 * 合并会话级插件 settings（每个 pluginId 一层浅合并）。
 * `patches` 的值为该插件的 partial 对象；字段传 `null` 表示删除该键。
 */
export async function updateConversationPluginSettings(
  conversationId: string,
  patches: Record<string, Record<string, unknown>>,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  const merged: Record<string, Record<string, unknown>> = {
    ...(idx.pluginSettings ?? {}),
  }
  for (const [pluginId, partial] of Object.entries(patches)) {
    const pid = pluginId.trim()
    if (!pid || !isPlainObject(partial)) continue
    const prev = merged[pid] ?? {}
    const bag = mergePluginSettingsPartial(prev, partial)
    if (Object.keys(bag).length === 0) {
      delete merged[pid]
    } else {
      merged[pid] = bag
    }
  }
  if (Object.keys(merged).length === 0) {
    delete next.pluginSettings
  } else {
    next.pluginSettings = merged
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 对话级世界书 id 列表（占位；传 `[]` 清空） */
export async function updateConversationLorebookIds(
  conversationId: string,
  lorebookIds: string[],
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const seen = new Set<string>()
  const cleaned: string[] = []
  for (const raw of lorebookIds) {
    if (typeof raw !== 'string') continue
    const id = raw.trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    cleaned.push(id)
  }
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  if (cleaned.length === 0) {
    delete next.lorebookIds
  } else {
    next.lorebookIds = cleaned
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 清除会话资料库递归覆盖（恢复继承全局） */
export async function clearConversationLorebookSettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  delete next.lorebookSettings
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 资料库递归：在「全局 + 当前覆盖」上合并 patch，稀疏写盘 */
export async function updateConversationLorebookSettings(
  conversationId: string,
  patch: Partial<LorebookSettings>,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const global = await readGlobalLorebookSettings()
  const current = resolveLorebookSettings(global, idx.lorebookSettings)
  const effective = normalizeLorebookSettings({ ...current, ...patch })
  const sparse = lorebookSettingsOverrideFromEffective(effective, global)
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  if (sparse) {
    next.lorebookSettings = sparse
  } else {
    // 会话显式覆盖：与全局相同也保留快照，避免被误判为「继承全局」
    next.lorebookSettings = { ...effective }
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 清除会话历史轮数覆盖（恢复继承全局） */
export async function clearConversationHistorySettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  delete next.historySettings
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 历史轮数：在「全局 + 当前覆盖」上合并 patch，稀疏写盘 */
export async function updateConversationHistorySettings(
  conversationId: string,
  patch: Partial<HistorySettings>,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const global = await readGlobalHistorySettings()
  const current = resolveHistorySettings(global, idx.historySettings)
  const effective = normalizeHistorySettings({ ...current, ...patch })
  const sparse = historySettingsOverrideFromEffective(effective, global)
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  if (sparse) {
    next.historySettings = sparse
  } else {
    next.historySettings = { ...effective }
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 清除会话记忆覆盖（恢复继承全局） */
export async function clearConversationMemorySettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  delete next.memorySettings
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 对话记忆：在「全局 + 当前覆盖」上合并 patch，稀疏写盘 */
export async function updateConversationMemorySettings(
  conversationId: string,
  patch: Partial<MemorySettings>,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const global = await readGlobalMemorySettings()
  const current = resolveMemorySettings(global, idx.memorySettings)
  const effective = normalizeMemorySettings({ ...current, ...patch })
  const sparse = memorySettingsOverrideFromEffective(effective, global)
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  if (sparse) {
    next.memorySettings = sparse
  } else {
    next.memorySettings = { ...effective }
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 清除会话 chat API 覆盖 */
export async function clearConversationChatApiSettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  if (next.apiPreset && typeof next.apiPreset === 'object') {
    const ap = { ...(next.apiPreset as Record<string, unknown>) }
    delete ap.chat
    if (Object.keys(ap).length === 0) {
      delete next.apiPreset
    } else {
      next.apiPreset = ap
    }
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 更新会话 chat API 覆盖（apiPreset.chat） */
export async function updateConversationChatApiSettings(
  conversationId: string,
  patch: ConversationChatBinding | null,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const settings = await readApiSettingsFromFile()
  const globalPresetId = settings?.activePresetId ?? ''
  const globalPreset =
    settings?.presets.find((p) => p.id === globalPresetId) ?? null

  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  const ap =
    next.apiPreset && typeof next.apiPreset === 'object' && !Array.isArray(next.apiPreset)
      ? { ...(next.apiPreset as Record<string, unknown>) }
      : {}

  if (patch === null) {
    delete ap.chat
  } else {
    const presetId = (patch.apiConfigId?.trim() || globalPresetId).trim()
    const preset =
      settings?.presets.find((p) => p.id === presetId) ?? globalPreset
    if (!preset) {
      throw new Error('api_preset_not_found')
    }
    const effective = mergePresetWithChatBinding(preset, patch)
    const sparse = chatBindingOverrideFromEffective(
      preset,
      effective,
      patch.apiConfigId?.trim(),
    )
    if (sparse) {
      ap.chat = sparse
    } else {
      // 会话显式覆盖：与 preset 相同也保留快照，避免被误判为「继承全局」
      ap.chat = conversationChatBindingSnapshot(preset, effective, patch)
    }
  }

  if (Object.keys(ap).length === 0) {
    delete next.apiPreset
  } else {
    next.apiPreset = ap
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 清除会话 Embedding 参数覆盖 */
export async function clearConversationEmbeddingApiSettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  delete next.embeddingApiSettings
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 对话 Embedding 参数：稀疏写盘 */
export async function updateConversationEmbeddingApiSettings(
  conversationId: string,
  patch: ConversationEmbeddingApiSettingsOverride,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const { readGlobalEmbeddingApiSettings } = await import(
    './user-preferences-file.js'
  )
  const global = await readGlobalEmbeddingApiSettings()
  const effective = resolveConversationEmbeddingModelSettings(global, {
    ...idx.embeddingApiSettings,
    ...patch,
  })
  const sparse = conversationEmbeddingOverrideFromEffective(effective, global)
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  if (sparse) {
    next.embeddingApiSettings = sparse
  } else {
    // 会话显式覆盖：与全局相同也保留快照
    next.embeddingApiSettings = {
      embeddingModel: effective.embeddingModel,
      embeddingDimensions: effective.embeddingDimensions,
    }
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

export {
  hasConversationChatBinding,
  hasConversationEmbeddingApiOverride,
  parseConversationChatBinding,
  parseConversationEmbeddingApiOverride,
  readConversationChatBinding,
}

/** 更新会话 Author's Note；`patch === null` 清除字段 */
export async function updateConversationAuthorsNote(
  conversationId: string,
  patch: AuthorsNotePatch | null,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  if (patch === null) {
    delete next.authorsNote
  } else {
    next.authorsNote = mergeAuthorsNote(idx.authorsNote, patch)
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 更新会话群聊设置；`patch === null` 重置为默认 */
export async function updateConversationGroupChat(
  conversationId: string,
  patch: unknown,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  const next: ConversationIndex = {
    ...idx,
    updatedAt: t,
    groupChat: mergeGroupChatSettings(idx.groupChat, patch),
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 清除会话预算裁切覆盖（恢复继承全局） */
export async function clearConversationBudgetTrimSettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  delete next.budgetTrimSettings
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 预算裁切：在「全局 + 当前覆盖」上合并 patch，稀疏写盘 */
export async function updateConversationBudgetTrimSettings(
  conversationId: string,
  patch: BudgetTrimSettingsOverride,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const global = await readGlobalBudgetTrimSettings()
  const current = resolveBudgetTrimSettings(global, idx.budgetTrimSettings)
  const effective = normalizeBudgetTrimSettings({
    trimOrder: Object.prototype.hasOwnProperty.call(patch, 'trimOrder')
      ? patch.trimOrder
      : current.trimOrder,
    minRetain: {
      ...current.minRetain,
      ...(patch.minRetain ?? {}),
    },
  })
  const sparse = budgetTrimSettingsOverrideFromEffective(effective, global)
  const t = nowIso()
  const next: ConversationIndex = { ...idx, updatedAt: t }
  if (sparse) {
    next.budgetTrimSettings = sparse
  } else {
    next.budgetTrimSettings = {
      trimOrder: [...effective.trimOrder],
      minRetain: { ...effective.minRetain },
    }
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 记录本会话远期记忆向量索引所用的 embedding 模型与维度 */
export async function updateConversationMemoryEmbeddingModel(
  conversationId: string,
  embeddingModel: string,
  embeddingDimensions?: number | null,
  hybridFtsProfile?: string | null,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const model = embeddingModel.trim()
  const t = nowIso()
  const dims =
    embeddingDimensions === undefined
      ? idx.memoryEmbeddingDimensions ?? null
      : embeddingDimensions
  const ftsProfile =
    hybridFtsProfile === undefined
      ? idx.memoryHybridFtsProfile ?? null
      : hybridFtsProfile
  const next: ConversationIndex = {
    ...idx,
    updatedAt: t,
    memoryEmbeddingModel: model || null,
    memoryEmbeddingDimensions: dims,
    memoryHybridFtsProfile: ftsProfile,
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 从 send 块读取当前用户正文 */
export function getTurnUserText(turn: Pick<TurnRecord, 'send'>): string {
  return typeof turn.send?.userText === 'string' ? turn.send.userText : ''
}

/** 更新 turn 展示用 user/assistant 正文（同步 active segment） */
export function patchTurnDisplayContent(
  turn: TurnRecord,
  userText: string,
  assistantContent: string,
): TurnRecord {
  const next: TurnRecord = { ...turn, send: { userText } }
  const segIdx = getActiveSegmentIndex(next)
  const seg = next.segments[segIdx]
  if (!seg) return next
  const segReceives = [...seg.receives]
  const activeIdx = Math.min(
    Math.max(0, Math.floor(seg.activeReceiveIndex) || 0),
    Math.max(0, segReceives.length - 1),
  )
  if (segReceives[activeIdx]) {
    segReceives[activeIdx] = {
      ...segReceives[activeIdx],
      content: assistantContent,
    }
  }
  next.segments = next.segments.map((s, i) =>
    i === segIdx ? { ...s, receives: segReceives } : s,
  )
  syncTurnSpeakerFromActiveSegment(next)
  return next
}

export interface ChunkFile {
  schemaVersion: 1
  meta: {
    chunkId: string
    ordinalRange: { start: number; end: number }
    /** 本块创建时的轮数容量；缺省从文件名推断 */
    turnsPerFile?: number
    links: {
      previous: string | null
      next: string | null
      branches: unknown[]
    }
  }
  turns: TurnRecord[]
}

function nowIso(): string {
  return new Date().toISOString()
}

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

function auditReceiveIdForSegment(
  turn: TurnRecord,
  segmentIndex: number,
): string | undefined {
  const seg = turn.segments[segmentIndex]
  if (!seg?.receives?.length) return undefined
  const idx = Math.min(
    Math.max(0, seg.activeReceiveIndex ?? 0),
    seg.receives.length - 1,
  )
  const id = seg.receives[idx]?.id?.trim()
  return id || undefined
}

function stripSegmentsMetaForDisk(
  segments: AssistantSegmentRecord[],
): AssistantSegmentRecord[] {
  let lastContentIdx = -1
  for (let i = segments.length - 1; i >= 0; i--) {
    if ((segments[i]?.receives?.length ?? 0) > 0) {
      lastContentIdx = i
      break
    }
  }
  if (lastContentIdx < 0) return segments
  const carryKeepIdx = lastContentIdx > 0 ? lastContentIdx - 1 : lastContentIdx
  return segments.map((s, i) => {
    if (!s.meta?.resolvedNextSpeakerAudit || i === carryKeepIdx) return s
    const { resolvedNextSpeakerAudit: _drop, ...restMeta } = s.meta
    const meta = Object.keys(restMeta).length > 0 ? restMeta : undefined
    return meta ? { ...s, meta } : { ...s, meta: undefined }
  })
}

/** 写盘时规范 plugins 与群聊字段 */
export function stripTurnForDisk(t: TurnRecord): TurnRecord {
  const out: TurnRecord = {
    turnId: t.turnId,
    turnOrdinal: t.turnOrdinal,
    send: t.send,
    plugins: Array.isArray(t.plugins) ? t.plugins : [],
    segments: stripSegmentsMetaForDisk(t.segments),
    activeSegmentIndex: t.activeSegmentIndex,
  }
  if (Array.isArray(t.speakerQueue) && t.speakerQueue.length > 0) {
    out.speakerQueue = t.speakerQueue
  }
  const speaker = typeof t.speakerCharacterId === 'string' ? t.speakerCharacterId.trim() : ''
  if (speaker) out.speakerCharacterId = speaker
  if (t.groupChatTurnState) {
    out.groupChatTurnState = {
      quotaRemaining: { ...t.groupChatTurnState.quotaRemaining },
      speakCount: { ...t.groupChatTurnState.speakCount },
    }
  }
  const createdAt =
    typeof t.createdAt === 'string' && t.createdAt.trim()
      ? t.createdAt.trim()
      : undefined
  if (createdAt) out.createdAt = createdAt
  return out
}

export async function writeChunkFile(
  conversationId: string,
  chunkFileName: string,
  chunk: ChunkFile,
): Promise<void> {
  const clean: ChunkFile = {
    ...chunk,
    turns: chunk.turns.map(stripTurnForDisk),
  }
  const rel = chunkFileName.replace(/\\/g, '/')
  const filePath = path.join(conversationDir(conversationId), rel)
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, JSON.stringify(clean, null, 2), 'utf8')
}

export async function writeBranchConversationIndex(
  id: string,
  branchPath: string,
  data: ConversationIndex,
): Promise<void> {
  const bp = normalizeBranchPath(branchPath)
  if (!bp) {
    await writeConversationIndex(id, data)
    return
  }
  const filePath = branchConversationIndexPath(id, bp)
  await mkdir(path.dirname(filePath), { recursive: true })
  const normalized = syncConversationCharacterFields(data)
  await writeJsonFileAtomic(filePath, normalized)
}

export async function updateConversationAuditDebug(
  conversationId: string,
  auditDebug: { enabled: boolean; maxStored: number },
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const enabled = auditDebug.enabled === true
  const clamped = Math.min(200, Math.max(0, Math.floor(auditDebug.maxStored)))
  const maxStored = enabled && clamped >= 1 ? clamped : clamped
  idx.auditDebug = { enabled, maxStored: maxStored >= 1 ? maxStored : DEFAULT_AUDIT_DEBUG_MAX }
  idx.updatedAt = nowIso()
  await writeConversationIndex(conversationId, idx)
  if (enabled && maxStored >= 1) {
    await trimChatAuditEntries(conversationId, maxStored)
  }
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
  return idx
}

async function ensureChatRoot(): Promise<void> {
  await mkdir(getChatsRoot(), { recursive: true })
}

/** 串行化 chat.index.json 读-改-写，避免并发 enrich / upsert 互相覆盖 */
let chatListFileLock: Promise<void> = Promise.resolve()

function withChatListFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chatListFileLock.then(fn)
  chatListFileLock = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

async function readChatListRaw(): Promise<ChatListFile> {
  try {
    const raw = await readFile(chatListFile(), 'utf8')
    const j = JSON.parse(raw) as ChatListFile
    if (!j || j.schemaVersion !== 1 || !Array.isArray(j.conversations)) {
      return { schemaVersion: 1, conversations: [] }
    }
    return j
  } catch {
    return { schemaVersion: 1, conversations: [] }
  }
}

async function writeChatListUnsafe(data: ChatListFile): Promise<void> {
  await ensureChatRoot()
  await writeFile(chatListFile(), JSON.stringify(data, null, 2), 'utf8')
}

/**
 * `chats/{id}/index.json` 存在但 `chat.index.json` 缺条目时补写（Syncthing 冲突、历史 bug 等）。
 * 须在 {@link withChatListFileLock} 内调用，或使用导出的包装函数。
 */
async function reconcileChatListWithDiskUnsafe(): Promise<boolean> {
  const list = await readChatListRaw()
  const known = new Set(
    list.conversations.map((c) => c.conversationId).filter(Boolean),
  )
  await ensureChatRoot()
  let entries
  try {
    entries = await readdir(getChatsRoot(), { withFileTypes: true })
  } catch {
    return false
  }
  const { enrichChatListEntry } = await import('./character-storage.js')
  let dirty = false
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const id = String(ent.name)
    if (!isValidConversationId(id) || known.has(id)) continue
    const idx = await readConversationIndex(id)
    if (!idx) continue
    list.conversations.push(
      await enrichChatListEntry(chatListEntryFromIndex(idx), idx),
    )
    known.add(id)
    dirty = true
  }
  if (!dirty) return false
  list.conversations.sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt, 'en'),
  )
  await writeChatListUnsafe(list)
  return true
}

export async function reconcileChatListWithDisk(): Promise<boolean> {
  return withChatListFileLock(() => reconcileChatListWithDiskUnsafe())
}

export async function readChatList(): Promise<ChatListFile> {
  return withChatListFileLock(async () => {
    await reconcileChatListWithDiskUnsafe()
    const list = await readChatListRaw()
    const {
      chatListEntryNeedsEnrich,
      enrichChatListEntry,
    } = await import('./character-storage.js')
    const pending: { index: number; entry: ChatListEntry }[] = []
    for (let i = 0; i < list.conversations.length; i++) {
      const c = list.conversations[i]!
      if (chatListEntryNeedsEnrich(c)) pending.push({ index: i, entry: c })
    }
    if (pending.length > 0) {
      const enriched = await Promise.all(
        pending.map(({ entry }) => enrichChatListEntry(entry)),
      )
      for (let j = 0; j < pending.length; j++) {
        list.conversations[pending[j]!.index] = enriched[j]!
      }
      await writeChatListUnsafe(list)
    }
    return list
  })
}

/** 角色卡元数据变更后，刷新引用该 id 的列表项快查字段 */
export async function refreshChatListEntriesForCharacter(
  characterId: string,
): Promise<void> {
  const cid = characterId.trim()
  if (!cid) return
  await withChatListFileLock(async () => {
    const { enrichChatListEntry } = await import('./character-storage.js')
    const list = await readChatListRaw()
    const pending: { index: number; entry: ChatListEntry }[] = []
    for (let i = 0; i < list.conversations.length; i++) {
      const c = list.conversations[i]!
      const ids = resolvedCharacterIds(c)
      const userCid =
        typeof c.userCharacterId === 'string' && c.userCharacterId.trim()
          ? c.userCharacterId.trim()
          : ''
      if (!ids.includes(cid) && userCid !== cid) continue
      pending.push({ index: i, entry: c })
    }
    if (pending.length === 0) return
    const enriched = await Promise.all(
      pending.map(async ({ entry }) => {
        const idx = await readConversationIndex(entry.conversationId)
        return enrichChatListEntry(entry, idx ?? undefined)
      }),
    )
    for (let j = 0; j < pending.length; j++) {
      list.conversations[pending[j]!.index] = enriched[j]!
    }
    await writeChatListUnsafe(list)
  })
}

/** 刷新列表项中的 active 分支轮数与最近对话时刻 */
export async function syncChatListConversationStats(
  conversationId: string,
): Promise<void> {
  await withChatListFileLock(async () => {
    const list = await readChatListRaw()
    const i = list.conversations.findIndex(
      (c) => c.conversationId === conversationId,
    )
    if (i < 0) return
    const prev = list.conversations[i]!
    let count = typeof prev.activeTurnCount === 'number' ? prev.activeTurnCount : 0
    let lastChatAt: string | null = prev.lastChatAt?.trim() || null
    try {
      const { listLastChatAtFromStats } = await import('./character-storage.js')
      const stats = await resolveActivePathConversationStats(conversationId)
      count = stats.turnCount
      lastChatAt = listLastChatAtFromStats(stats, prev.updatedAt) ?? null
    } catch {
      // 保留 prev 统计，避免 transient 错误覆盖有效值
    }
    const nextLast = lastChatAt?.trim() || null
    if (prev.activeTurnCount === count && (prev.lastChatAt ?? null) === nextLast) {
      return
    }
    const { lastChatAt: _prevLast, ...base } = prev
    list.conversations[i] = {
      ...base,
      activeTurnCount: count,
      ...(nextLast ? { lastChatAt: nextLast } : {}),
    }
    await writeChatListUnsafe(list)
  })
}

export async function upsertChatListEntry(
  entry: ChatListEntry,
  source?: ConversationIndex,
  options?: { refreshConversationStats?: boolean },
): Promise<void> {
  const { enrichChatListEntry, listLastChatAtFromStats } = await import(
    './character-storage.js'
  )
  await withChatListFileLock(async () => {
    await reconcileChatListWithDiskUnsafe()
    const list = await readChatListRaw()
    const existing = list.conversations.find(
      (c) => c.conversationId === entry.conversationId,
    )
    let merged: ChatListEntry = {
      ...entry,
      activeTurnCount: entry.activeTurnCount ?? existing?.activeTurnCount,
      lastChatAt: entry.lastChatAt ?? existing?.lastChatAt,
    }
    if (options?.refreshConversationStats) {
      try {
        const stats = await resolveActivePathConversationStats(
          merged.conversationId,
        )
        const { lastChatAt: _drop, ...withoutLast } = merged
        const resolvedLast = listLastChatAtFromStats(stats, merged.updatedAt)
        merged = {
          ...withoutLast,
          activeTurnCount: stats.turnCount,
          ...(resolvedLast ? { lastChatAt: resolvedLast } : {}),
        }
      } catch {
        // 保留 merged 已有统计
      }
    }
    const enriched = await enrichChatListEntry(merged, source)
    const i = list.conversations.findIndex(
      (c) => c.conversationId === enriched.conversationId,
    )
    if (i >= 0) list.conversations[i] = enriched
    else list.conversations.unshift(enriched)
    list.conversations.sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt, 'en'),
    )
    await writeChatListUnsafe(list)
  })
}

export function conversationDir(id: string): string {
  return path.join(getChatsRoot(), id)
}

export function conversationIndexPath(id: string): string {
  return path.join(conversationDir(id), 'index.json')
}

/** 分支子目录 index.json（branchPath 为空时会话根） */
export function branchConversationIndexPath(
  id: string,
  branchPath: string,
): string {
  const bp = normalizeBranchPath(branchPath)
  if (!bp) return conversationIndexPath(id)
  return path.join(conversationDir(id), bp, 'index.json')
}

export async function readBranchConversationIndex(
  id: string,
  branchPath: string,
): Promise<ConversationIndex | null> {
  const bp = normalizeBranchPath(branchPath)
  if (!bp) return readConversationIndex(id)
  try {
    const raw = await readFile(branchConversationIndexPath(id, bp), 'utf8')
    return JSON.parse(raw) as ConversationIndex
  } catch {
    return null
  }
}

export async function readConversationIndex(
  id: string,
): Promise<ConversationIndex | null> {
  const filePath = conversationIndexPath(id)
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const raw = await readFile(filePath, 'utf8')
      return JSON.parse(raw) as ConversationIndex
    } catch (e) {
      // 并发非原子写盘时可能读到半截 JSON；短延迟后重试一次
      const isParse =
        e instanceof SyntaxError ||
        (e instanceof Error && e.message.includes('JSON'))
      if (isParse && attempt === 0) {
        await new Promise((r) => setTimeout(r, 15))
        continue
      }
      return null
    }
  }
  return null
}

/** 同目录临时文件 + rename，避免并发读到半截 JSON */
async function writeJsonFileAtomic(
  filePath: string,
  data: unknown,
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  const body = `${JSON.stringify(data, null, 2)}\n`
  await writeFile(tmp, body, 'utf8')
  try {
    await rename(tmp, filePath)
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => {})
    throw e
  }
}

export async function writeConversationIndex(
  id: string,
  data: ConversationIndex,
): Promise<void> {
  const dir = conversationDir(id)
  await mkdir(dir, { recursive: true })
  const normalized = syncConversationCharacterFields(data)
  await writeJsonFileAtomic(conversationIndexPath(id), normalized)
}

/** 仅更新 macroLocalVars（读-改-写单字段，降低并发覆盖其它索引字段的风险） */
export async function patchConversationMacroLocalVars(
  conversationId: string,
  merge: (current: Record<string, string>) => Record<string, string>,
): Promise<boolean> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return false
  idx.macroLocalVars = merge(idx.macroLocalVars ?? {})
  idx.updatedAt = nowIso()
  await writeConversationIndex(conversationId, idx)
  return true
}

/** 创建空会话（仅索引，无 chunk），供首页列表展示 */
export async function createConversationStub(
  conversationId: string,
  title: string,
): Promise<ConversationIndex> {
  const t = nowIso()
  const idx: ConversationIndex = {
    schemaVersion: 1,
    conversationId,
    title: title.trim() || '新对话',
    createdAt: t,
    updatedAt: t,
    headChunkFile: null,
    tailChunkFile: null,
    backupSettings: { everyNRounds: 0, maxKeptBackups: 0 },
    branches: [],
    auditDebug: { enabled: false, maxStored: DEFAULT_AUDIT_DEBUG_MAX },
  }
  const defaultTemplate = await readGlobalDefaultAuthorsNote()
  const seededAuthorsNote = seedAuthorsNoteFromTemplate(defaultTemplate)
  if (seededAuthorsNote) {
    idx.authorsNote = seededAuthorsNote
  }
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
  return idx
}

export async function updateConversationTitle(
  conversationId: string,
  title: string,
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const t = nowIso()
  idx.title = title.trim() || idx.title
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
  return idx
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
  /** debug 审计快照（服务端组装；见 DOC/24） */
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
  idx.headChunkFile = firstChunkFile
  idx.tailChunkFile = firstChunkFile
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx, {
    refreshConversationStats: true,
  })

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

/** 角色卡开场白：仅助手 receives，无用户正文；用于新建对话的 first_mes / alternate_greetings。 */
export async function saveOpeningTurn(params: {
  conversationId: string
  receives: TurnReceive[]
  activeReceiveIndex?: number
}): Promise<{ index: ConversationIndex; chunk: ChunkFile } | null> {
  const { conversationId, receives, activeReceiveIndex = 0 } = params
  if (!receives.length) return null
  let idx = await readConversationIndex(conversationId)
  if (!idx) return null
  if (idx.headChunkFile) {
    return null
  }

  const used = new Set<string>()
  const turnCreatedAt = nowIso()
  const mappedReceives = mapReceivesWithShortIds(receives, used)
  const activeIdx = Math.min(
    Math.max(0, activeReceiveIndex),
    Math.max(0, mappedReceives.length - 1),
  )
  const defaultSpeaker = idx.characterIds?.[0]?.trim() ?? ''
  const turn: TurnRecord = {
    turnId: allocateShortId(used),
    turnOrdinal: 0,
    createdAt: turnCreatedAt,
    send: { userText: '' },
    plugins: [],
    segments: [],
    activeSegmentIndex: 0,
  }
  buildFirstSegmentOnTurn(turn, used, {
    speakerCharacterId: defaultSpeaker,
    receives: mappedReceives,
    activeReceiveIndex: activeIdx,
  })

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
  idx.headChunkFile = firstChunkFile
  idx.tailChunkFile = firstChunkFile
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx, {
    refreshConversationStats: true,
  })
  return { index: idx, chunk }
}

export interface ImportedTurnBatchItem {
  turnOrdinal: number
  userText: string
  receives: TurnReceive[]
  activeReceiveIndex: number
  createdAt?: string
}

function buildTurnRecordFromImportedItem(
  item: ImportedTurnBatchItem,
  speaker: string,
  used: Set<string>,
): TurnRecord {
  const mappedReceives = mapReceivesWithShortIds(item.receives, used)
  const activeIdx = Math.min(
    Math.max(0, item.activeReceiveIndex),
    Math.max(0, mappedReceives.length - 1),
  )
  const turn: TurnRecord = {
    turnId: allocateShortId(used),
    turnOrdinal: item.turnOrdinal,
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    send: { userText: item.userText },
    plugins: [],
    segments: [],
    activeSegmentIndex: 0,
  }
  buildFirstSegmentOnTurn(turn, used, {
    speakerCharacterId: speaker,
    receives: mappedReceives,
    activeReceiveIndex: activeIdx,
  })
  return turn
}

async function patchImportChunkNextLink(
  conversationId: string,
  prevFileName: string,
  nextFileName: string,
): Promise<void> {
  const prevChunk = await readChunkFile(conversationId, prevFileName)
  if (!prevChunk) {
    throw new Error(
      `import patch next link: previous chunk missing (${prevFileName})`,
    )
  }
  prevChunk.meta.links.next = nextFileName
  await writeChunkFile(conversationId, prevFileName, prevChunk)
}

/** 同会话导入互斥（流式 import 持锁至 finalize/rollback） */
const conversationImportActive = new Set<string>()

function acquireConversationImportLock(conversationId: string): boolean {
  if (conversationImportActive.has(conversationId)) return false
  conversationImportActive.add(conversationId)
  return true
}

function releaseConversationImportLock(conversationId: string): void {
  conversationImportActive.delete(conversationId)
}

async function scheduleMemoryForImportChunks(
  conversationId: string,
  chunkFileNames: string[],
): Promise<void> {
  for (const fileName of chunkFileNames) {
    const chunk = await readChunkFile(conversationId, fileName)
    if (!chunk) continue
    for (const turn of chunk.turns) {
      scheduleMemoryIndexUpsert(conversationId, turn, fileName)
    }
  }
}

export interface ConversationImportSession {
  readonly conversationId: string
  readonly turnCount: number
  appendTurn(item: ImportedTurnBatchItem): Promise<void>
  finalize(): Promise<{ index: ConversationIndex; turnCount: number }>
  rollback(): Promise<void>
}

/** 空会话流式/批量导入 session：峰值内存 ≈ 单 chunk 轮数（buffer + 当前 flush slice） */
export async function openConversationImportSession(params: {
  conversationId: string
  speakerCharacterId: string
  usedEntityIds?: Set<string>
}): Promise<ConversationImportSession | null> {
  const { conversationId, speakerCharacterId } = params
  const speaker = speakerCharacterId.trim()
  if (!speaker) return null

  if (!acquireConversationImportLock(conversationId)) return null

  const idx = await readConversationIndex(conversationId)
  if (!idx || idx.headChunkFile) {
    releaseConversationImportLock(conversationId)
    return null
  }

  const used = params.usedEntityIds ?? new Set<string>()
  const chunkSettings = await readGlobalChunkSettings()
  const cap = chunkSettings.turnsPerFile

  let turnCount = 0
  let buffer: TurnRecord[] = []
  const writtenChunkFiles: string[] = []
  let headChunkFile: string | null = null
  let tailChunkFile: string | null = null

  async function flushBuffer(): Promise<void> {
    if (buffer.length === 0) return
    const slice = buffer
    buffer = []
    const startOrd = slice[0]!.turnOrdinal
    const window = ordinalRangeForNewChunk(startOrd, cap)
    const fileName = chunkFileNameForRange(window.start, window.end)
    const prev = tailChunkFile
    const chunk: ChunkFile = {
      schemaVersion: 1,
      meta: {
        chunkId: chunkIdFromFileName(fileName),
        ordinalRange: {
          start: slice[0]!.turnOrdinal,
          end: slice[slice.length - 1]!.turnOrdinal,
        },
        turnsPerFile: cap,
        links: {
          previous: prev,
          next: null,
          branches: [],
        },
      },
      turns: slice,
    }
    await mkdir(conversationDir(conversationId), { recursive: true })
    await writeChunkFile(conversationId, fileName, chunk)
    writtenChunkFiles.push(fileName)
    if (prev) {
      await patchImportChunkNextLink(conversationId, prev, fileName)
    }
    if (!headChunkFile) headChunkFile = fileName
    tailChunkFile = fileName
  }

  async function rollbackWritten(): Promise<void> {
    await Promise.allSettled(
      writtenChunkFiles.map((fileName) =>
        rm(path.join(conversationDir(conversationId), fileName), {
          force: true,
        }),
      ),
    )
    writtenChunkFiles.length = 0
    buffer = []
    headChunkFile = null
    tailChunkFile = null
    turnCount = 0
  }

  async function restoreEmptyConversationIndex(
    savedHead: string | null,
    savedTail: string | null,
    savedUpdatedAt: string,
  ): Promise<void> {
    const cur = await readConversationIndex(conversationId)
    if (!cur) return
    cur.headChunkFile = savedHead
    cur.tailChunkFile = savedTail
    cur.updatedAt = savedUpdatedAt
    await writeConversationIndex(conversationId, cur)
    invalidateChunkIndexSyncCache(conversationId)
  }

  return {
    conversationId,
    get turnCount() {
      return turnCount
    },
    async appendTurn(item: ImportedTurnBatchItem): Promise<void> {
      buffer.push(buildTurnRecordFromImportedItem(item, speaker, used))
      turnCount++
      if (buffer.length >= cap) {
        await flushBuffer()
      }
    },
    async finalize(): Promise<{ index: ConversationIndex; turnCount: number }> {
      try {
        if (turnCount === 0) {
          throw new Error('import session has no turns')
        }
        await flushBuffer()
        if (!headChunkFile || !tailChunkFile) {
          throw new Error('import session produced no chunks')
        }
        const freshIdx = await readConversationIndex(conversationId)
        if (!freshIdx || freshIdx.headChunkFile) {
          await rollbackWritten()
          throw new Error('conversation no longer empty')
        }
        const savedHead = freshIdx.headChunkFile
        const savedTail = freshIdx.tailChunkFile
        const savedUpdatedAt = freshIdx.updatedAt
        const chunkFilesSnapshot = [...writtenChunkFiles]
        const t = nowIso()
        freshIdx.headChunkFile = headChunkFile
        freshIdx.tailChunkFile = tailChunkFile
        freshIdx.updatedAt = t
        try {
          await writeConversationIndex(conversationId, freshIdx)
          invalidateChunkIndexSyncCache(conversationId)
        } catch (e) {
          await rollbackWritten()
          throw e
        }
        try {
          await upsertChatListEntry(chatListEntryFromIndex(freshIdx), freshIdx, {
            refreshConversationStats: true,
          })
        } catch (e) {
          await restoreEmptyConversationIndex(savedHead, savedTail, savedUpdatedAt)
          await rollbackWritten()
          throw e
        }
        await scheduleMemoryForImportChunks(conversationId, chunkFilesSnapshot)
        return { index: freshIdx, turnCount }
      } finally {
        releaseConversationImportLock(conversationId)
      }
    },
    async rollback(): Promise<void> {
      try {
        await rollbackWritten()
      } finally {
        releaseConversationImportLock(conversationId)
      }
    },
  }
}

/** ST 等批量导入：空会话写入多轮（按 turnsPerFile 分块；内部走 import session） */
export async function importTurnsToEmptyConversation(params: {
  conversationId: string
  speakerCharacterId: string
  turns: ImportedTurnBatchItem[]
  usedEntityIds?: Set<string>
}): Promise<{ index: ConversationIndex; turnCount: number } | null> {
  const { turns } = params
  if (!turns.length) return null
  const session = await openConversationImportSession(params)
  if (!session) return null
  try {
    for (const item of turns) {
      await session.appendTurn(item)
    }
    return await session.finalize()
  } catch (e) {
    await session.rollback()
    throw e
  }
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
  const { idx, tailFile: chunkName, tail: chunk, sealedChunkFiles } = prepared
  for (const sealed of sealedChunkFiles) {
    void sealChunkMemorySegment(conversationId, sealed, branchPath).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[chat-storage] seal chunk memory failed:', e)
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
  if (prepared.isNewBranchChunk || !idx.headChunkFile) {
    idx.headChunkFile = chunkName
  }
  idx.tailChunkFile = chunkName
  idx.updatedAt = t
  if (branchPath) {
    await writeBranchConversationIndex(conversationId, branchPath, idx)
  } else {
    await writeConversationIndex(conversationId, idx)
  }
  invalidateChunkIndexSyncCache(conversationId)
  const rootIdx = await readConversationIndex(conversationId)
  if (rootIdx) {
    rootIdx.updatedAt = t
    await writeConversationIndex(conversationId, rootIdx)
    await upsertChatListEntry(chatListEntryFromIndex(rootIdx), rootIdx, {
      refreshConversationStats: true,
    })
  }
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
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
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

export async function deleteConversation(
  conversationId: string,
): Promise<boolean> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return false
  try {
    await rm(conversationDir(conversationId), { recursive: true, force: true })
  } catch {
    return false
  }
  void wipeConversationMemoryIndex(conversationId).catch(() => {})
  await withChatListFileLock(async () => {
    await reconcileChatListWithDiskUnsafe()
    const list = await readChatListRaw()
    list.conversations = list.conversations.filter(
      (c) => c.conversationId !== conversationId,
    )
    await writeChatListUnsafe(list)
  })
  return true
}

export async function readTailChunk(
  conversationId: string,
): Promise<ChunkFile | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return null
  try {
    const p = path.join(conversationDir(conversationId), idx.tailChunkFile)
    const raw = await readFile(p, 'utf8')
    return JSON.parse(raw) as ChunkFile
  } catch {
    return null
  }
}

function tailChunkPath(
  conversationId: string,
  idx: ConversationIndex,
): string | null {
  if (!idx.tailChunkFile) return null
  return path.join(conversationDir(conversationId), idx.tailChunkFile)
}

/** 仅合并 turn.plugins 条目（Separate 重新生成等）；可选同步 active receive 正文 */
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
  const idx = await readConversationIndex(conversationId)
  if (idx) {
    idx.updatedAt = nowIso()
    await writeConversationIndex(conversationId, idx)
    await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
  }
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
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
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
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
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

/** 删除尾块中的整轮；若删空 tail 且存在 previous 则链式回退 tail 指针（active 分支感知） */
export async function removeTurnAtOrdinalInTailChunk(
  conversationId: string,
  turnOrdinal: number,
): Promise<boolean> {
  const located = await readChunkContainingOrdinal(conversationId, turnOrdinal)
  if (!located) return false

  const { fileName: tailFileName, branchPath } = located
  const bp = normalizeBranchPath(branchPath)
  const idx = bp
    ? await readBranchConversationIndex(conversationId, bp)
    : await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return false

  const scopeTailBasename = normalizeTailChunkBasename(idx.tailChunkFile, bp)
  const isTailChunk = tailFileName === scopeTailBasename

  const storagePath = chunkStorageRelativePath(bp, tailFileName)
  let chunk: ChunkFile
  try {
    const raw = await readFile(
      path.join(conversationDir(conversationId), storagePath),
      'utf8',
    )
    chunk = JSON.parse(raw) as ChunkFile
  } catch {
    return false
  }

  const victim = chunk.turns.find((x) => x.turnOrdinal === turnOrdinal)
  const victimTurnId = victim?.turnId

  const filtered = chunk.turns.filter((t) => t.turnOrdinal !== turnOrdinal)
  if (filtered.length === chunk.turns.length) return false

  const t = nowIso()

  if (filtered.length === 0) {
    if (!isTailChunk) return false
    const previousFile = chunk.meta.links.previous
    const chunkAbsPath = path.join(conversationDir(conversationId), storagePath)
    try {
      await rm(chunkAbsPath, { force: true })
    } catch {
      return false
    }
    if (previousFile) {
      const prevStorage = chunkStorageRelativePath(bp, previousFile)
      let prevChunk: ChunkFile
      try {
        const raw = await readFile(
          path.join(conversationDir(conversationId), prevStorage),
          'utf8',
        )
        prevChunk = JSON.parse(raw) as ChunkFile
      } catch {
        return false
      }
      prevChunk.meta.links.next = null
      await writeChunkFile(conversationId, prevStorage, prevChunk)
      idx.tailChunkFile = previousFile
      if (idx.headChunkFile === tailFileName) {
        idx.headChunkFile = previousFile
      }
    } else {
      idx.headChunkFile = null
      idx.tailChunkFile = null
    }
    idx.updatedAt = t
    if (bp) {
      await writeBranchConversationIndex(conversationId, bp, idx)
    } else {
      await writeConversationIndex(conversationId, idx)
    }
    invalidateChunkIndexSyncCache(conversationId)
    const rootIdx = await readConversationIndex(conversationId)
    if (rootIdx) {
      rootIdx.updatedAt = t
      await writeConversationIndex(conversationId, rootIdx)
      await upsertChatListEntry(chatListEntryFromIndex(rootIdx), rootIdx, {
        refreshConversationStats: true,
      })
    }
    if (victimTurnId) {
      void removeChatAuditEntriesByTurnId(conversationId, victimTurnId)
      scheduleMemoryIndexDelete(conversationId, victimTurnId)
    }
    return true
  }

  chunk.turns = filtered
  chunk.meta.ordinalRange = {
    start: filtered[0]!.turnOrdinal,
    end: filtered[filtered.length - 1]!.turnOrdinal,
  }

  await writeChunkFile(conversationId, storagePath, chunk)
  idx.updatedAt = t
  if (bp) {
    await writeBranchConversationIndex(conversationId, bp, idx)
  } else {
    await writeConversationIndex(conversationId, idx)
  }
  const rootIdx = await readConversationIndex(conversationId)
  if (rootIdx) {
    rootIdx.updatedAt = t
    await writeConversationIndex(conversationId, rootIdx)
    await upsertChatListEntry(chatListEntryFromIndex(rootIdx), rootIdx, {
      refreshConversationStats: true,
    })
  }
  if (victimTurnId) {
    void removeChatAuditEntriesByTurnId(conversationId, victimTurnId)
    scheduleMemoryIndexDelete(conversationId, victimTurnId)
  }
  return true
}
