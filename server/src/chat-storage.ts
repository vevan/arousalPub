import { allocateShortId } from './short-id.js'
import { mergeTurnPluginEntry } from './turn-plugin-utils.js'
import type { TurnPluginEntry } from './plugin-types.js'
import {
  mergeAuthorsNote,
  type AuthorsNotePatch,
  type AuthorsNoteSettings,
} from './authors-note-settings.js'
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { getChatsRoot } from './config.js'
import { normalizeBranchPath } from './chunk-path.js'
import { isValidConversationId } from './conversation-id.js'
import type { ResolvedFeatureAudit } from './feature-binding-resolve.js'
import type { ChatAuditSnapshotInput } from './chat-audit-types.js'
import {
  appendChatAuditEntry,
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
  readGlobalHistorySettings,
  readGlobalLorebookSettings,
  readGlobalMemorySettings,
} from './user-preferences-file.js'
import {
  scheduleMemoryIndexDelete,
  scheduleMemoryIndexUpsert,
  sealChunkMemorySegment,
  wipeConversationMemoryIndex,
} from './memory-index.js'
import {
  buildFirstChunkDescriptor,
  loadConversationChunksForOrdinalRange,
  prepareTailChunkForAppend,
  readChunkContainingOrdinal,
} from './chunk-chain.js'
import {
  CONVERSATION_BATCH_MAX_TURNS,
  type TurnContentPatchInput,
} from './turn-patch-body.js'
import { readGlobalChunkSettings } from './user-preferences-file.js'

/** 与 {@link getChatsRoot} 相同，保留旧名供外部引用 */
export function chatRoot(): string {
  return getChatsRoot()
}

/** @deprecated 使用 {@link chatListFile} */
export const CHAT_ROOT = chatRoot

function chatListFile(): string {
  return path.join(getChatsRoot(), 'chat.index.json')
}

/** @deprecated 首块文件名请用 {@link buildFirstChunkDescriptor} */
export const CHUNK_NAME_FIRST = 'turn-000000-000099.json'
export const CHAT_PROMPT_FILE = 'chat-prompt.json'
export const DEFAULT_PROMPT_DEBUG_MAX = 10

export interface ChatListEntry {
  conversationId: string
  title: string
  updatedAt: string
  /** 用户 persona 卡 id；组装时注入 `<user>` 块，宏仍用 userName 快照 */
  userCharacterId?: string
  /** 兼容：首张卡 id，等同于 characterIds[0] */
  characterId?: string | null
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
}

export interface ChatListFile {
  schemaVersion: 1
  conversations: ChatListEntry[]
}

export interface ConversationIndex {
  schemaVersion: 1
  conversationId: string
  title: string
  characterId?: string | null
  /** 多卡绑定；优先于单独的 characterId。写盘时会同步 characterId = characterIds[0] ?? null */
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
   * 调试：chat-audit.json（`auditDebug` 定案；`promptDebug` 为遗留）。
   * `enabled === false` 或 `maxStored < 1` 时不写入新审计条目。
   */
  auditDebug?: { enabled: boolean; maxStored: number }
  /** @deprecated 使用 auditDebug；读盘时仍兼容 */
  promptDebug?: { maxStored: number }
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

/** 存盘仅 { userText }；读盘兼容历史 sends[] */
export type TurnSendBlock =
  | { userText: string }
  | { sends: { id: string; userText: string }[]; activeSendIndex: number }

export interface TurnRecord {
  turnId: string
  turnOrdinal: number
  send: TurnSendBlock
  receives: TurnReceive[]
  activeReceiveIndex: number
  plugins: unknown[]
}

/** 收集 chunk 内已有 turnId / receive.id，供短 id 分配去重 */
export function collectChunkEntityIds(chunk: ChunkFile | null): Set<string> {
  const used = new Set<string>()
  if (!chunk?.turns?.length) return used
  for (const t of chunk.turns) {
    const tid = typeof t.turnId === 'string' ? t.turnId.trim() : ''
    if (tid) used.add(tid)
    for (const r of t.receives ?? []) {
      const rid = typeof r.id === 'string' ? r.id.trim() : ''
      if (rid) used.add(rid)
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
  for (const r of turn.receives ?? []) {
    const rid = typeof r.id === 'string' ? r.id.trim() : ''
    if (rid) used.delete(rid)
  }
  const tid = typeof turn.turnId === 'string' ? turn.turnId.trim() : ''
  if (tid) used.delete(tid)
}

/** 在内存中更新单轮正文与 receives（调用方维护 chunk 级 used 集合） */
function applyTurnContentUpdate(
  turn: TurnRecord,
  used: Set<string>,
  userText: string,
  receives: TurnReceive[],
  activeReceiveIndex: number,
): void {
  if (!receives.length) return
  releaseTurnEntityIds(turn, used)
  const prevReceives = turn.receives ?? []
  turn.send = { userText }
  turn.receives = mapReceivesWithShortIds(receives, used).map((rec) => {
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
  turn.activeReceiveIndex = Math.min(
    Math.max(0, activeReceiveIndex),
    turn.receives.length - 1,
  )
}

export interface BatchTurnUpdateResult {
  ok: number
  failed: { turnOrdinal: number; error: string }[]
}

/**
 * 批量更新多轮：每个 chunk 至多 read+write 一次，index 至多写一次。
 * 用于插件 patchTurns（如 swipe-cleaner），避免逐轮 PATCH 重复读写同一 chunk。
 */
export async function batchUpdateConversationTurns(
  conversationId: string,
  patches: TurnContentPatchInput[],
): Promise<BatchTurnUpdateResult> {
  if (!patches.length) return { ok: 0, failed: [] }
  if (patches.length > CONVERSATION_BATCH_MAX_TURNS) {
    throw new Error('turns_batch_too_large')
  }

  const ordinals = patches.map((p) => p.turnOrdinal)
  const minOrd = Math.min(...ordinals)
  const maxOrd = Math.max(...ordinals)
  const chunkMap = await loadConversationChunksForOrdinalRange(
    conversationId,
    minOrd,
    maxOrd,
  )
  const idx = await readConversationIndex(conversationId)
  if (!idx) {
    return {
      ok: 0,
      failed: patches.map((p) => ({
        turnOrdinal: p.turnOrdinal,
        error: 'conversation_not_found',
      })),
    }
  }

  type Located = {
    patch: TurnContentPatchInput
    fileName: string
    turn: TurnRecord
  }
  const located: Located[] = []
  const failed: { turnOrdinal: number; error: string }[] = []

  for (const patch of patches) {
    let hit: Located | null = null
    for (const [fileName, chunk] of chunkMap) {
      const turn = chunk.turns.find((t) => t.turnOrdinal === patch.turnOrdinal)
      if (turn) {
        hit = { patch, fileName, turn }
        break
      }
    }
    if (!hit) {
      failed.push({ turnOrdinal: patch.turnOrdinal, error: 'turn_chunk_not_found' })
      continue
    }
    located.push(hit)
  }

  const byFile = new Map<string, Located[]>()
  for (const item of located) {
    const list = byFile.get(item.fileName) ?? []
    list.push(item)
    byFile.set(item.fileName, list)
  }

  const memoryUpserts: { turn: TurnRecord; chunkName: string }[] = []
  let ok = 0

  for (const [fileName, items] of byFile) {
    const chunk = chunkMap.get(fileName)
    if (!chunk) continue
    const used = collectChunkEntityIds(chunk)
    for (const { patch, turn } of items) {
      applyTurnContentUpdate(
        turn,
        used,
        patch.userText,
        patch.receives,
        patch.activeReceiveIndex,
      )
      memoryUpserts.push({ turn, chunkName: fileName })
      ok += 1
    }
    await writeChunkFile(conversationId, fileName, chunk)
  }

  if (ok > 0) {
    const t = nowIso()
    idx.updatedAt = t
    await writeConversationIndex(conversationId, idx)
    await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
    for (const { turn, chunkName } of memoryUpserts) {
      scheduleMemoryIndexUpsert(conversationId, turn, chunkName)
    }
  }

  return { ok, failed }
}

export interface ChatPromptMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatPromptEntry {
  savedAt: string
  chunkName: string
  turnId: string
  turnOrdinal: number
  messages: ChatPromptMessage[]
}

export interface ChatPromptFile {
  schemaVersion: 1
  entries: ChatPromptEntry[]
}

/** 解析会话绑定的角色卡 id（顺序即 {{char}}、{{char2}}…） */
export function resolvedCharacterIds(
  idx: Pick<ConversationIndex, 'characterIds' | 'characterId'>,
): string[] {
  if (Array.isArray(idx.characterIds)) {
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of idx.characterIds) {
      if (typeof raw !== 'string') continue
      const id = raw.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    if (out.length > 0) return out
  }
  const legacy = idx.characterId
  if (typeof legacy === 'string' && legacy.trim()) return [legacy.trim()]
  return []
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

/** 写盘前同步 characterId ↔ characterIds[0]，避免只存其一造成歧义 */
export function syncConversationCharacterFields(
  idx: ConversationIndex,
): ConversationIndex {
  const ids = resolvedCharacterIds(idx)
  return {
    ...idx,
    characterIds: ids.length > 0 ? ids : undefined,
    characterId: ids[0] ?? null,
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
    characterId: ids[0] ?? null,
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
    characterId: cleaned[0] ?? null,
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
): Promise<ConversationIndex | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx) return null
  const model = embeddingModel.trim()
  const t = nowIso()
  const dims =
    embeddingDimensions === undefined
      ? idx.memoryEmbeddingDimensions ?? null
      : embeddingDimensions
  const next: ConversationIndex = {
    ...idx,
    updatedAt: t,
    memoryEmbeddingModel: model || null,
    memoryEmbeddingDimensions: dims,
  }
  await writeConversationIndex(conversationId, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  return next
}

/** 从 send 块读取当前用户正文 */
export function getTurnUserText(turn: Pick<TurnRecord, 'send' | 'turnId'>): string {
  const raw = turn.send
  if (
    raw &&
    typeof raw === 'object' &&
    'userText' in raw &&
    typeof (raw as { userText: unknown }).userText === 'string'
  ) {
    return (raw as { userText: string }).userText
  }
  return ''
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

export function conversationPromptPath(id: string): string {
  return path.join(conversationDir(id), CHAT_PROMPT_FILE)
}

export function getPromptDebugMaxStored(idx: ConversationIndex | null): number {
  const n = idx?.promptDebug?.maxStored
  if (typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 200) {
    return n
  }
  return DEFAULT_PROMPT_DEBUG_MAX
}

/** 写盘时去掉历史字段 messages，并规范 plugins */
function stripTurnForDisk(t: TurnRecord): TurnRecord {
  return {
    turnId: t.turnId,
    turnOrdinal: t.turnOrdinal,
    send: t.send,
    receives: t.receives,
    activeReceiveIndex: t.activeReceiveIndex,
    plugins: Array.isArray(t.plugins) ? t.plugins : [],
  }
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
  await writeFile(
    path.join(conversationDir(conversationId), chunkFileName),
    JSON.stringify(clean, null, 2),
    'utf8',
  )
}

export async function readChatPromptFile(
  conversationId: string,
): Promise<ChatPromptFile> {
  try {
    const raw = await readFile(conversationPromptPath(conversationId), 'utf8')
    const j = JSON.parse(raw) as ChatPromptFile
    if (!j || j.schemaVersion !== 1 || !Array.isArray(j.entries)) {
      return { schemaVersion: 1, entries: [] }
    }
    return j
  } catch {
    return { schemaVersion: 1, entries: [] }
  }
}

function validatePromptMessages(raw: unknown): ChatPromptMessage[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null
  const out: ChatPromptMessage[] = []
  for (const m of raw) {
    if (!m || typeof m !== 'object') return null
    const role = (m as { role?: unknown }).role
    const content = (m as { content?: unknown }).content
    if (role !== 'system' && role !== 'user' && role !== 'assistant') return null
    if (typeof content !== 'string') return null
    out.push({ role, content })
  }
  return out
}

export async function appendChatPromptDebugEntry(
  conversationId: string,
  params: {
    chunkName: string
    turnId: string
    turnOrdinal: number
    messages: unknown
  },
): Promise<void> {
  const idx = await readConversationIndex(conversationId)
  const max = getPromptDebugMaxStored(idx)
  /** 索引 maxStored=0：不写新快照（中断/未配置亦同） */
  if (max < 1) return
  const msgs = validatePromptMessages(params.messages)
  if (!msgs) return
  const file = await readChatPromptFile(conversationId)
  const filtered = file.entries.filter((e) => e.turnId !== params.turnId)
  filtered.push({
    savedAt: nowIso(),
    chunkName: params.chunkName,
    turnId: params.turnId,
    turnOrdinal: params.turnOrdinal,
    messages: msgs,
  })
  const entries = filtered.slice(-max)
  await mkdir(conversationDir(conversationId), { recursive: true })
  await writeFile(
    conversationPromptPath(conversationId),
    JSON.stringify({ schemaVersion: 1, entries }, null, 2),
    'utf8',
  )
}

async function removeChatPromptEntriesByTurnId(
  conversationId: string,
  turnId: string,
): Promise<void> {
  try {
    const file = await readChatPromptFile(conversationId)
    const entries = file.entries.filter((e) => e.turnId !== turnId)
    if (entries.length === file.entries.length) return
    await writeFile(
      conversationPromptPath(conversationId),
      JSON.stringify({ schemaVersion: 1, entries }, null, 2),
      'utf8',
    )
  } catch {
    /* 文件可能不存在 */
  }
}

/** 遗留：仅 maxStored；enabled 由 maxStored>=1 隐含 */
export async function updateConversationPromptDebugMax(
  conversationId: string,
  maxStored: number,
): Promise<ConversationIndex | null> {
  const clamped = Math.min(200, Math.max(0, Math.floor(maxStored)))
  return updateConversationAuditDebug(conversationId, {
    enabled: clamped >= 1,
    maxStored: clamped >= 1 ? clamped : DEFAULT_PROMPT_DEBUG_MAX,
  })
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
  delete idx.promptDebug
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

/**
 * `chats/{id}/index.json` 存在但 `chat.index.json` 缺条目时补写（Syncthing 冲突、历史 bug 等）。
 */
export async function reconcileChatListWithDisk(): Promise<boolean> {
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
  await writeChatList(list)
  return true
}

export async function readChatList(): Promise<ChatListFile> {
  await reconcileChatListWithDisk()
  const list = await readChatListRaw()
  const {
    chatListEntryNeedsEnrich,
    enrichChatListEntry,
  } = await import('./character-storage.js')
  let dirty = false
  for (let i = 0; i < list.conversations.length; i++) {
    const c = list.conversations[i]
    if (!chatListEntryNeedsEnrich(c)) continue
    list.conversations[i] = await enrichChatListEntry(c)
    dirty = true
  }
  if (dirty) await writeChatList(list)
  return list
}

/** 角色卡元数据变更后，刷新引用该 id 的列表项快查字段 */
export async function refreshChatListEntriesForCharacter(
  characterId: string,
): Promise<void> {
  const cid = characterId.trim()
  if (!cid) return
  const { enrichChatListEntry } = await import('./character-storage.js')
  const list = await readChatListRaw()
  let dirty = false
  for (let i = 0; i < list.conversations.length; i++) {
    const c = list.conversations[i]
    const ids = resolvedCharacterIds(c)
    const userCid =
      typeof c.userCharacterId === 'string' && c.userCharacterId.trim()
        ? c.userCharacterId.trim()
        : ''
    if (!ids.includes(cid) && userCid !== cid) continue
    const idx = await readConversationIndex(c.conversationId)
    const enriched = await enrichChatListEntry(c, idx ?? undefined)
    list.conversations[i] = enriched
    dirty = true
  }
  if (dirty) await writeChatList(list)
}

async function writeChatList(data: ChatListFile): Promise<void> {
  await ensureChatRoot()
  await writeFile(chatListFile(), JSON.stringify(data, null, 2), 'utf8')
}

export async function upsertChatListEntry(
  entry: ChatListEntry,
  source?: ConversationIndex,
): Promise<void> {
  const { enrichChatListEntry } = await import('./character-storage.js')
  const enriched = await enrichChatListEntry(entry, source)
  await reconcileChatListWithDisk()
  const list = await readChatListRaw()
  const i = list.conversations.findIndex(
    (c) => c.conversationId === enriched.conversationId,
  )
  if (i >= 0) list.conversations[i] = enriched
  else list.conversations.unshift(enriched)
  list.conversations.sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt, 'en'),
  )
  await writeChatList(list)
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
  try {
    const raw = await readFile(conversationIndexPath(id), 'utf8')
    return JSON.parse(raw) as ConversationIndex
  } catch {
    return null
  }
}

export async function writeConversationIndex(
  id: string,
  data: ConversationIndex,
): Promise<void> {
  const dir = conversationDir(id)
  await mkdir(dir, { recursive: true })
  const normalized = syncConversationCharacterFields(data)
  await writeFile(
    conversationIndexPath(id),
    JSON.stringify(normalized, null, 2),
    'utf8',
  )
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
    characterId: null,
    createdAt: t,
    updatedAt: t,
    headChunkFile: null,
    tailChunkFile: null,
    backupSettings: { everyNRounds: 0, maxKeptBackups: 0 },
    branches: [],
    promptDebug: { maxStored: DEFAULT_PROMPT_DEBUG_MAX },
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
}): Promise<{ index: ConversationIndex; chunk: ChunkFile } | null> {
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
  } = params
  let idx = await readConversationIndex(conversationId)
  if (!idx) return null
  if (idx.headChunkFile) {
    return null
  }

  const used = new Set<string>()
  const turnId = allocateShortId(used)
  const receiveRuntime = buildReceiveRuntime({
    model,
    durationMs,
    estimatedTokens,
    completionTokens,
    resolvedFeature,
  })
  const turn: TurnRecord = {
    turnId,
    turnOrdinal: 0,
    send: { userText },
    receives: mapReceivesWithShortIds(
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
    ),
    activeReceiveIndex: 0,
    plugins: (turnPluginEntries ?? []).reduce<unknown[]>(
      (acc, entry) => mergeTurnPluginEntry(acc, entry),
      [],
    ),
  }

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
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx)

  /** 对话落盘成功后再写快照；无有效 messages 或索引关闭写入时不落盘 */
  if (auditSnapshot !== undefined) {
    const idxForAudit = await readConversationIndex(conversationId)
    await appendChatAuditEntry(conversationId, idxForAudit, {
      chunkName: firstChunkFile,
      turnId,
      turnOrdinal: 0,
      snapshot: auditSnapshot,
    })
  }

  scheduleMemoryIndexUpsert(conversationId, turn, firstChunkFile)

  return { index: idx, chunk }
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
  const turn: TurnRecord = {
    turnId: allocateShortId(used),
    turnOrdinal: 0,
    send: { userText: '' },
    receives: mapReceivesWithShortIds(receives, used),
    activeReceiveIndex: Math.min(
      Math.max(0, activeReceiveIndex),
      receives.length - 1,
    ),
    plugins: [],
  }

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
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
  return { index: idx, chunk }
}

/** 在已有尾块末尾追加一轮对话 */
export async function appendConversationTurn(params: {
  conversationId: string
  userText: string
  receives: TurnReceive[]
  activeReceiveIndex: number
  auditSnapshot?: ChatAuditSnapshotInput
  turnPluginEntries?: TurnPluginEntry[]
}): Promise<boolean> {
  const {
    conversationId,
    userText,
    receives,
    activeReceiveIndex,
    auditSnapshot,
    turnPluginEntries,
  } = params
  if (!receives.length) return false
  const prepared = await prepareTailChunkForAppend(conversationId)
  if (!prepared) return false
  const { idx, tailFile: chunkName, tail: chunk, sealedChunkFiles } = prepared
  for (const sealed of sealedChunkFiles) {
    void sealChunkMemorySegment(conversationId, sealed).catch((e) => {
      // eslint-disable-next-line no-console
      console.warn('[chat-storage] seal chunk memory failed:', e)
    })
  }
  const nextOrd =
    chunk.turns.length === 0
      ? chunk.meta.ordinalRange.start
      : Math.max(...chunk.turns.map((t) => t.turnOrdinal)) + 1
  const used = collectChunkEntityIds(chunk)
  const turn: TurnRecord = {
    turnId: allocateShortId(used),
    turnOrdinal: nextOrd,
    send: { userText },
    receives: mapReceivesWithShortIds(receives, used),
    activeReceiveIndex: Math.min(
      Math.max(0, activeReceiveIndex),
      receives.length - 1,
    ),
    plugins: (turnPluginEntries ?? []).reduce<unknown[]>(
      (acc, entry) => mergeTurnPluginEntry(acc, entry),
      [],
    ),
  }
  chunk.turns.push(turn)
  chunk.meta.ordinalRange = {
    start:
      chunk.turns.length === 1
        ? turn.turnOrdinal
        : Math.min(chunk.meta.ordinalRange.start, turn.turnOrdinal),
    end: turn.turnOrdinal,
  }
  await writeChunkFile(conversationId, chunkName, chunk)
  const t = nowIso()
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
  if (auditSnapshot !== undefined) {
    const idxForAudit = await readConversationIndex(conversationId)
    await appendChatAuditEntry(conversationId, idxForAudit, {
      chunkName,
      turnId: turn.turnId,
      turnOrdinal: turn.turnOrdinal,
      snapshot: auditSnapshot,
    })
  }
  scheduleMemoryIndexUpsert(conversationId, turn, chunkName)
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
  const list = await readChatList()
  list.conversations = list.conversations.filter(
    (c) => c.conversationId !== conversationId,
  )
  await writeChatList(list)
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

/** 更新任意 chunk 中某轮：用户正文 + 助手 receives（全量替换） */
export async function updateTurnContentInTailChunk(
  conversationId: string,
  turnOrdinal: number,
  userText: string,
  receives: TurnReceive[],
  activeReceiveIndex: number,
  auditSnapshot?: ChatAuditSnapshotInput,
  turnPluginEntries?: TurnPluginEntry[],
): Promise<boolean> {
  if (!receives.length) return false
  const located = await readChunkContainingOrdinal(conversationId, turnOrdinal)
  if (!located) return false
  const { chunk, fileName: chunkName } = located
  const idx = await readConversationIndex(conversationId)
  if (!idx) return false
  const ti = chunk.turns.findIndex((t) => t.turnOrdinal === turnOrdinal)
  if (ti < 0) return false
  const turn = chunk.turns[ti]
  const turnId = turn.turnId
  const used = collectChunkEntityIds(chunk)
  applyTurnContentUpdate(turn, used, userText, receives, activeReceiveIndex)
  if (turnPluginEntries?.length) {
    let plugins = Array.isArray(turn.plugins) ? turn.plugins : []
    for (const entry of turnPluginEntries) {
      plugins = mergeTurnPluginEntry(plugins, entry)
    }
    turn.plugins = plugins
  }
  await writeChunkFile(conversationId, chunkName, chunk)
  const t = nowIso()
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
  if (auditSnapshot !== undefined) {
    const idxForAudit = await readConversationIndex(conversationId)
    await appendChatAuditEntry(conversationId, idxForAudit, {
      chunkName,
      turnId,
      turnOrdinal,
      snapshot: auditSnapshot,
    })
  }
  scheduleMemoryIndexUpsert(conversationId, turn, chunkName)
  return true
}

/** 删除尾块中的整轮；若删空 tail 且存在 previous 则链式回退 tail 指针 */
export async function removeTurnAtOrdinalInTailChunk(
  conversationId: string,
  turnOrdinal: number,
): Promise<boolean> {
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return false
  const tailFileName = idx.tailChunkFile
  const chunkPath = tailChunkPath(conversationId, idx)
  if (!chunkPath) return false
  let chunk: ChunkFile
  try {
    const raw = await readFile(chunkPath, 'utf8')
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
    const previousFile = chunk.meta.links.previous
    try {
      await rm(chunkPath, { force: true })
    } catch {
      return false
    }
    if (previousFile) {
      let prevChunk: ChunkFile
      try {
        const raw = await readFile(
          path.join(conversationDir(conversationId), previousFile),
          'utf8',
        )
        prevChunk = JSON.parse(raw) as ChunkFile
      } catch {
        return false
      }
      prevChunk.meta.links.next = null
      await writeChunkFile(conversationId, previousFile, prevChunk)
      idx.tailChunkFile = previousFile
      if (idx.headChunkFile === tailFileName) {
        idx.headChunkFile = previousFile
      }
    } else {
      idx.headChunkFile = null
      idx.tailChunkFile = null
    }
    idx.updatedAt = t
    await writeConversationIndex(conversationId, idx)
    await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
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

  await writeChunkFile(conversationId, tailFileName, chunk)
  idx.updatedAt = t
  await writeConversationIndex(conversationId, idx)
  await upsertChatListEntry(chatListEntryFromIndex(idx), idx)
  if (victimTurnId) {
    void removeChatAuditEntriesByTurnId(conversationId, victimTurnId)
    scheduleMemoryIndexDelete(conversationId, victimTurnId)
  }
  return true
}
