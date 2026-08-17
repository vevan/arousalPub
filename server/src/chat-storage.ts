import { allocateShortId } from './short-id.js'
import {
  mergeAuthorsNote,
  seedAuthorsNoteFromTemplate,
  type AuthorsNotePatch,
  type AuthorsNoteSettings,
} from './authors-note-settings.js'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import {
  chatListEntryFromIndex,
  removeChatListEntry,
  updateConversationIndexAndList,
  upsertChatListEntry,
} from './chat-list-store.js'
import path from 'node:path'
import { getChatsRoot } from './config.js'
import { normalizeBranchPath, chunkStorageRelativePath } from './chunk-path.js'
import { isValidConversationId } from './conversation-id.js'
import {
  DEFAULT_AUDIT_DEBUG_MAX,
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
  knowledgeSettingsOverrideFromEffective,
  normalizeKnowledgeSettings,
  resolveKnowledgeSettings,
  type KnowledgeSettingsOverride,
} from './knowledge-settings.js'
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
  readGlobalKnowledgeSettings,
  readGlobalLorebookSettings,
  readGlobalMemorySettings,
  readGlobalChunkSettings,
} from './user-preferences-file.js'
import type { HybridFtsSettings } from './hybrid-fts-settings.js'
import {
  isConversationMemoryEmbedActive,
  isTurnEligibleForMemoryEmbed,
  scheduleMemoryIndexDelete,
  scheduleMemoryIndexUpsert,
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
  readChunkContainingOrdinal,
  readChunkFile,
  readTailChunkAt,
  resolveActivePathConversationStats,
} from './chunk-chain.js'
import {
  CONVERSATION_BATCH_MAX_TURNS,
  type TurnContentPatchInput,
} from './turn-patch-types.js'
import {
  collectChunkEntityIds,
} from './chat-turn-accessors.js'
import {
  applyTurnContentUpdate,
  buildFirstSegmentOnTurn,
  mapReceivesWithShortIds,
  nowIso,
} from './chat-turn-mutate.js'
import type {
  ChunkFile,
  ConversationIndex,
  TurnReceive,
  TurnRecord,
} from './chat-turn-types.js'
import {
  conversationDir,
  mutateBranchConversationIndex,
  mutateConversationIndex,
  readBranchConversationIndex,
  readConversationIndex,
  resolveConversationChunkFilePath,
  resolvedCharacterIds,
  runConversationIndexTask,
  writeChunkFile,
  writeConversationIndex,
} from './chat-storage-io.js'
import {
  mergeGroupChatSettings,
  normalizeGroupChatSettings,
  groupChatWithEnsuredMemberColors,
  type GroupChatSettings,
  type GroupChatTurnState,
} from './shared/group-chat-settings.js'

export type {
  AssistantSegmentRecord,
  ChunkFile,
  ConversationIndex,
  TurnReceive,
  TurnRecord,
} from './chat-turn-types.js'

export type {
  GroupChatSettings,
  GroupChatTurnState,
} from './shared/group-chat-settings.js'

export {
  buildReceiveRuntime,
  collectChunkEntityIds,
  getTurnUserText,
  patchTurnDisplayContent,
  stripTurnForDisk,
} from './chat-turn-accessors.js'

export {
  CONVERSATION_BATCH_MAX_TURNS,
  type TurnContentPatchInput,
} from './turn-patch-types.js'

export {
  branchConversationIndexPath,
  conversationDir,
  conversationIndexPath,
  mutateBranchConversationIndex,
  mutateConversationIndex,
  readBranchConversationIndex,
  readConversationIndex,
  resolvedCharacterIds,
  resolvedLorebookIds,
  resolveConversationChunkFilePath,
  runConversationIndexTask,
  syncConversationCharacterFields,
  updateConversationMemoryEmbeddingModel,
  writeBranchConversationIndex,
  writeChunkFile,
  writeConversationIndex,
  writeConversationIndexUnsafe,
} from './chat-storage-io.js'
export type {
  ChatListEntry,
  ChatListFile,
  ChatListTurnStats,
} from './chat-list-store.js'
export {
  chatListEntryFromIndex,
  readChatList,
  reconcileChatListWithDisk,
  refreshChatListEntriesForCharacter,
  syncChatListConversationStats,
  upsertChatListEntry,
  upsertChatListEntries,
  updateConversationIndexAndList,
} from './chat-list-store.js'





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
async function batchUpdateConversationTurnsUnsafe(
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
    // CL8 收尾：统一走组合 API（mutate + upsert 一次完成）
    await updateConversationIndexAndList(conversationId, (fresh) => {
      fresh.updatedAt = t
      return fresh
    })
    for (const branchPath of touchedBranchPaths) {
      if (!branchPath) continue
      await mutateBranchConversationIndex(conversationId, branchPath, (fresh) => {
        fresh.updatedAt = t
        return fresh
      })
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

/**
 * Serialize the complete chunk read/modify/write transaction per conversation.
 * The unsafe implementation may call index mutations internally; the keyed
 * queue is re-entrant for the same key, so those calls remain inline.
 */
export function batchUpdateConversationTurns(
  conversationId: string,
  patches: TurnContentPatchInput[],
): Promise<BatchTurnUpdateResult> {
  return runConversationIndexTask(conversationId, () =>
    batchUpdateConversationTurnsUnsafe(conversationId, patches),
  )
}


export async function updateConversationUserCharacterId(
  conversationId: string,
  userCharacterId: string | null,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
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
    return next
  })
}

export async function updateConversationBackgroundImageFileId(
  conversationId: string,
  backgroundImageFileId: string | null,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    if (
      backgroundImageFileId === null ||
      (typeof backgroundImageFileId === 'string' && !backgroundImageFileId.trim())
    ) {
      delete next.backgroundImageFileId
    } else {
      next.backgroundImageFileId = backgroundImageFileId.trim().toLowerCase()
    }
    return next
  })
}

export async function updateConversationBgmFileId(
  conversationId: string,
  bgmFileId: string | null,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    if (
      bgmFileId === null ||
      (typeof bgmFileId === 'string' && !bgmFileId.trim())
    ) {
      delete next.bgmFileId
    } else {
      next.bgmFileId = bgmFileId.trim().toLowerCase()
    }
    return next
  })
}

export async function updateConversationUserName(
  conversationId: string,
  userName: string | null,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    if (userName === null || (typeof userName === 'string' && !userName.trim())) {
      delete next.userName
    } else if (typeof userName === 'string') {
      next.userName = userName.trim()
    }
    return next
  })
}

export async function updateConversationCharacterBindings(
  conversationId: string,
  characterIds: string[],
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
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
    const gc = groupChatWithEnsuredMemberColors(
      normalizeGroupChatSettings(idx.groupChat),
      cleaned,
    )
    if (gc.enabled) next.groupChat = gc
    return next
  })
}

/** 对话级提示词预设：传 `null` 或空字符串则移除字段（回退全局预设） */
export async function updateConversationPromptPresetId(
  conversationId: string,
  promptPresetId: string | null,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    const trimmed =
      typeof promptPresetId === 'string' ? promptPresetId.trim() : ''
    if (!trimmed) {
      delete next.promptPresetId
    } else {
      next.promptPresetId = trimmed
    }
    return next
  })
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
  return updateConversationIndexAndList(conversationId, (idx) => {
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
    return next
  })
}

/** 对话级世界书 id 列表（占位；传 `[]` 清空） */
export async function updateConversationLorebookIds(
  conversationId: string,
  lorebookIds: string[],
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
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
    return next
  })
}

/** 对话级知识库 id 列表（传 `[]` 清空） */
export async function updateConversationKnowledgeBaseIds(
  conversationId: string,
  knowledgeBaseIds: string[],
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const seen = new Set<string>()
    const cleaned: string[] = []
    for (const raw of knowledgeBaseIds) {
      if (typeof raw !== 'string') continue
      const id = raw.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      cleaned.push(id)
    }
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    if (cleaned.length === 0) {
      delete next.knowledgeBaseIds
    } else {
      next.knowledgeBaseIds = cleaned
    }
    return next
  })
}

/** 清除会话资料库递归覆盖（恢复继承全局） */
export async function clearConversationLorebookSettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    delete next.lorebookSettings
    return next
  })
}

/** 资料库递归：在「全局 + 当前覆盖」上合并 patch，稀疏写盘 */
export async function updateConversationLorebookSettings(
  conversationId: string,
  patch: Partial<LorebookSettings>,
): Promise<ConversationIndex | null> {
  const global = await readGlobalLorebookSettings()
  return updateConversationIndexAndList(conversationId, (idx) => {
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
    return next
  })
}

/** 清除会话知识库 RAG 覆盖（恢复继承全局） */
export async function clearConversationKnowledgeSettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    delete next.knowledgeSettings
    return next
  })
}

/** 知识库 RAG：在「全局 + 当前覆盖」上合并 patch，稀疏写盘 */
export async function updateConversationKnowledgeSettings(
  conversationId: string,
  patch: KnowledgeSettingsOverride,
): Promise<ConversationIndex | null> {
  const global = await readGlobalKnowledgeSettings()
  return updateConversationIndexAndList(conversationId, (idx) => {
    const current = resolveKnowledgeSettings(global, idx.knowledgeSettings)
    const effective = normalizeKnowledgeSettings({ ...current, ...patch })
    const sparse = knowledgeSettingsOverrideFromEffective(effective, global)
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    if (sparse) {
      next.knowledgeSettings = sparse
    } else {
      next.knowledgeSettings = { ...effective }
    }
    return next
  })
}

/**
 * 从所有会话的 knowledgeBaseIds 中摘除 kbId（删库时用）。
 * 扫描 chats 根目录下各会话 index。
 */
export async function removeKnowledgeBaseIdFromAllConversations(
  kbId: string,
): Promise<number> {
  const id = typeof kbId === 'string' ? kbId.trim() : ''
  if (!id) return 0
  await mkdir(getChatsRoot(), { recursive: true })
  let entries
  try {
    entries = await readdir(getChatsRoot(), { withFileTypes: true })
  } catch {
    return 0
  }
  let cleared = 0
  for (const ent of entries) {
    if (!ent.isDirectory()) continue
    const conversationId = String(ent.name)
    if (!isValidConversationId(conversationId)) continue
    const idx = await readConversationIndex(conversationId)
    if (!idx || !Array.isArray(idx.knowledgeBaseIds)) continue
    if (!idx.knowledgeBaseIds.includes(id)) continue
    const nextIds = idx.knowledgeBaseIds.filter((x) => x !== id)
    await updateConversationKnowledgeBaseIds(conversationId, nextIds)
    cleared += 1
  }
  return cleared
}

/** 清除会话历史轮数覆盖（恢复继承全局） */
export async function clearConversationHistorySettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    delete next.historySettings
    return next
  })
}

/** 历史轮数：在「全局 + 当前覆盖」上合并 patch，稀疏写盘 */
export async function updateConversationHistorySettings(
  conversationId: string,
  patch: Partial<HistorySettings>,
): Promise<ConversationIndex | null> {
  const global = await readGlobalHistorySettings()
  return updateConversationIndexAndList(conversationId, (idx) => {
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
    return next
  })
}

/** 清除会话记忆覆盖（恢复继承全局） */
export async function clearConversationMemorySettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    delete next.memorySettings
    return next
  })
}

/** 对话记忆：在「全局 + 当前覆盖」上合并 patch，稀疏写盘 */
export async function updateConversationMemorySettings(
  conversationId: string,
  patch: Partial<MemorySettings>,
): Promise<ConversationIndex | null> {
  const global = await readGlobalMemorySettings()
  return updateConversationIndexAndList(conversationId, (idx) => {
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
    return next
  })
}

/** 清除会话远期记忆 Hybrid FTS 覆盖（恢复跟随全局） */
export async function clearConversationMemoryHybridFts(
  conversationId: string,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const next: ConversationIndex = { ...idx, updatedAt: nowIso() }
    delete next.memoryHybridFts
    return next
  })
}

/** 写入经过严格解析与词典就绪检查的完整会话覆盖 */
export async function updateConversationMemoryHybridFts(
  conversationId: string,
  settings: HybridFtsSettings,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => ({
    ...idx,
    updatedAt: nowIso(),
    memoryHybridFts: { ...settings },
  }))
}

/** 清除会话 chat API 覆盖 */
export async function clearConversationChatApiSettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
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
    return next
  })
}

/** 更新会话 chat API 覆盖（apiPreset.chat） */
export async function updateConversationChatApiSettings(
  conversationId: string,
  patch: ConversationChatBinding | null,
): Promise<ConversationIndex | null> {
  const settings = await readApiSettingsFromFile()
  const globalPresetId = settings?.activePresetId ?? ''
  const globalPreset =
    settings?.presets.find((p) => p.id === globalPresetId) ?? null

  return updateConversationIndexAndList(conversationId, (idx) => {
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
    return next
  })
}

/** 清除会话 Embedding 参数覆盖 */
export async function clearConversationEmbeddingApiSettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    delete next.embeddingApiSettings
    return next
  })
}

/** 对话 Embedding 参数：稀疏写盘 */
export async function updateConversationEmbeddingApiSettings(
  conversationId: string,
  patch: ConversationEmbeddingApiSettingsOverride,
): Promise<ConversationIndex | null> {
  const { readGlobalEmbeddingApiSettings } = await import(
    './user-preferences-file.js'
  )
  const global = await readGlobalEmbeddingApiSettings()
  return updateConversationIndexAndList(conversationId, (idx) => {
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
    return next
  })
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
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    if (patch === null) {
      delete next.authorsNote
    } else {
      next.authorsNote = mergeAuthorsNote(idx.authorsNote, patch)
    }
    return next
  })
}

/** 更新会话群聊设置；`patch === null` 重置为默认 */
export async function updateConversationGroupChat(
  conversationId: string,
  patch: unknown,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    const merged = mergeGroupChatSettings(idx.groupChat, patch)
    const groupChat = groupChatWithEnsuredMemberColors(
      merged,
      idx.characterIds ?? [],
    )
    return {
      ...idx,
      updatedAt: t,
      groupChat,
    }
  })
}

/** 清除会话预算裁切覆盖（恢复继承全局） */
export async function clearConversationBudgetTrimSettings(
  conversationId: string,
): Promise<ConversationIndex | null> {
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    const next: ConversationIndex = { ...idx, updatedAt: t }
    delete next.budgetTrimSettings
    return next
  })
}

/** 预算裁切：在「全局 + 当前覆盖」上合并 patch，稀疏写盘 */
export async function updateConversationBudgetTrimSettings(
  conversationId: string,
  patch: BudgetTrimSettingsOverride,
): Promise<ConversationIndex | null> {
  const global = await readGlobalBudgetTrimSettings()
  return updateConversationIndexAndList(conversationId, (idx) => {
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
    return next
  })
}

export async function updateConversationAuditDebug(
  conversationId: string,
  auditDebug: { enabled: boolean; maxStored: number },
): Promise<ConversationIndex | null> {
  const enabled = auditDebug.enabled === true
  const clamped = Math.min(200, Math.max(0, Math.floor(auditDebug.maxStored)))
  const maxStored = enabled && clamped >= 1 ? clamped : clamped
  const idx = await updateConversationIndexAndList(conversationId, (cur) => {
    cur.auditDebug = {
      enabled,
      maxStored: maxStored >= 1 ? maxStored : DEFAULT_AUDIT_DEBUG_MAX,
    }
    cur.updatedAt = nowIso()
    return cur
  })
  if (!idx) return null
  if (enabled && maxStored >= 1) {
    await trimChatAuditEntries(conversationId, maxStored)
  }
  return idx
}


/** 仅更新 macroLocalVars（读-改-写单字段，降低并发覆盖其它索引字段的风险） */
export async function patchConversationMacroLocalVars(
  conversationId: string,
  merge: (current: Record<string, string>) => Record<string, string>,
): Promise<boolean> {
  const next = await mutateConversationIndex(conversationId, (idx) => {
    idx.macroLocalVars = merge(idx.macroLocalVars ?? {})
    idx.updatedAt = nowIso()
    return idx
  })
  return next !== null
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
  return updateConversationIndexAndList(conversationId, (idx) => {
    const t = nowIso()
    idx.title = title.trim() || idx.title
    idx.updatedAt = t
    return idx
  })
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
      turnStats: { turnCount: 1, lastChatAt: turnCreatedAt },
    },
  )
  if (!written) return null
  idx = written
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
  let lastTurnCreatedAt: string | null = null
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
    await mutateConversationIndex(conversationId, (cur) => {
      cur.headChunkFile = savedHead
      cur.tailChunkFile = savedTail
      cur.updatedAt = savedUpdatedAt
      return cur
    })
    invalidateChunkIndexSyncCache(conversationId)
  }

  return {
    conversationId,
    get turnCount() {
      return turnCount
    },
    async appendTurn(item: ImportedTurnBatchItem): Promise<void> {
      const record = buildTurnRecordFromImportedItem(item, speaker, used)
      buffer.push(record)
      lastTurnCreatedAt = record.createdAt ?? null
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
        let writtenIdx: ConversationIndex
        try {
          // CL8：mutate + list 组合；upsert 失败仍需 restoreEmpty（index 已写入）
          const written = await updateConversationIndexAndList(
            conversationId,
            (cur) => {
              if (cur.headChunkFile) return null
              cur.headChunkFile = headChunkFile
              cur.tailChunkFile = tailChunkFile
              cur.updatedAt = t
              return cur
            },
            {
              // CL5：导入已知总轮数与末轮 createdAt（空会话导入，active 路径即主路径）
              turnStats: { turnCount, lastChatAt: lastTurnCreatedAt },
            },
          )
          if (!written) {
            await rollbackWritten()
            throw new Error('conversation no longer empty')
          }
          writtenIdx = written
          invalidateChunkIndexSyncCache(conversationId)
        } catch (e) {
          await restoreEmptyConversationIndex(savedHead, savedTail, savedUpdatedAt)
          await rollbackWritten()
          throw e
        }
        await scheduleMemoryForImportChunks(conversationId, chunkFilesSnapshot)
        return { index: writtenIdx, turnCount }
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
  await removeChatListEntry(conversationId)
  return true
}

export async function readTailChunk(
  conversationId: string,
): Promise<ChunkFile | null> {
  // Root-index tail with the same path containment as readChunkFile.
  return readTailChunkAt(conversationId, '')
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
      resolveConversationChunkFilePath(conversationId, storagePath),
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
    // Validate + load previous before deleting the empty tail, so a bad
    // previous link cannot leave a half-deleted chain.
    let prevStorage: string | null = null
    let prevChunk: ChunkFile | null = null
    if (previousFile) {
      try {
        prevStorage = chunkStorageRelativePath(bp, previousFile)
        const raw = await readFile(
          resolveConversationChunkFilePath(conversationId, prevStorage),
          'utf8',
        )
        prevChunk = JSON.parse(raw) as ChunkFile
      } catch {
        return false
      }
    }
    let chunkAbsPath: string
    try {
      chunkAbsPath = resolveConversationChunkFilePath(conversationId, storagePath)
    } catch {
      return false
    }
    try {
      await rm(chunkAbsPath, { force: true })
    } catch {
      return false
    }
    if (previousFile && prevStorage && prevChunk) {
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
    const listOpts = { refreshConversationStats: true as const }
    if (bp) {
      await mutateBranchConversationIndex(conversationId, bp, (fresh) => {
        if (previousFile) {
          fresh.tailChunkFile = previousFile
          if (fresh.headChunkFile === tailFileName) {
            fresh.headChunkFile = previousFile
          }
        } else {
          fresh.headChunkFile = null
          fresh.tailChunkFile = null
        }
        fresh.updatedAt = t
        return fresh
      })
      // CL8：根 index 触 updatedAt + 列表
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
          if (previousFile) {
            fresh.tailChunkFile = previousFile
            if (fresh.headChunkFile === tailFileName) {
              fresh.headChunkFile = previousFile
            }
          } else {
            fresh.headChunkFile = null
            fresh.tailChunkFile = null
          }
          fresh.updatedAt = t
          return fresh
        },
        listOpts,
      )
    }
    invalidateChunkIndexSyncCache(conversationId)
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
  const listOpts = { refreshConversationStats: true as const }
  if (bp) {
    await mutateBranchConversationIndex(conversationId, bp, (fresh) => {
      fresh.updatedAt = t
      return fresh
    })
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
        fresh.updatedAt = t
        return fresh
      },
      listOpts,
    )
  }
  if (victimTurnId) {
    void removeChatAuditEntriesByTurnId(conversationId, victimTurnId)
    scheduleMemoryIndexDelete(conversationId, victimTurnId)
  }
  return true
}
