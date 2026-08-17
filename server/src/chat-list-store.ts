import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import path from 'node:path'
import { getChatsRoot } from './config.js'
import { normalizeBranchPath } from './chunk-path.js'
import { isValidConversationId } from './conversation-id.js'
import { resolveActivePathConversationStats } from './chunk-chain.js'
import {
  mutateConversationIndex,
  readConversationIndex,
  resolvedCharacterIds,
} from './chat-storage-io.js'
import type { ConversationIndex } from './chat-turn-types.js'

/**
 * chat.index.json 列表存储：锁 / 读 / 写 / reconcile / upsert*（CL7，对齐图谱社区 89）。
 * 与 character-storage 仅经动态 import（enrich / listLastChatAtFromStats），避免静态环。
 * 不反向 import chat-storage。
 */

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
async function ensureChatRoot(): Promise<void> {
  await mkdir(getChatsRoot(), { recursive: true })
}

function chatListFile(): string {
  return path.join(getChatsRoot(), 'chat.index.json')
}

/** 串行化 chat.index.json 读-改-写，避免并发 enrich / upsert 互相覆盖 */
let chatListFileLock: Promise<void> = Promise.resolve()

/** CL4：reconcile 待执行标记。启动为 true（首次读列表自愈）；列表读/写失败置 true */
let chatListReconcileDirty = true
/** 上次 reconcile 成功时刻；读列表时超过间隔兜底触发（替代死定时器） */
let lastChatListReconcileAt = 0
const CHAT_LIST_RECONCILE_MIN_INTERVAL_MS = 30_000

function withChatListFileLock<T>(fn: () => Promise<T>): Promise<T> {
  const run = chatListFileLock.then(fn)
  chatListFileLock = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

function isErrnoCode(e: unknown, code: string): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'code' in e &&
    (e as { code?: unknown }).code === code
  )
}

/** CL2：条目等价比较。JSON 归一化后深比较，忽略键序与 undefined 键（文件回读与新建对象同构） */
function chatListEntryEqual(a: ChatListEntry, b: ChatListEntry): boolean {
  return isDeepStrictEqual(
    JSON.parse(JSON.stringify(a)),
    JSON.parse(JSON.stringify(b)),
  )
}
/** CL9：desc 序（updatedAt localeCompare 'en'）二分插入位置；等值插到相同值之后（与稳定排序一致） */
function chatListSortedInsertIndex(
  list: ChatListEntry[],
  entry: ChatListEntry,
): number {
  let lo = 0
  let hi = list.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (list[mid]!.updatedAt.localeCompare(entry.updatedAt, 'en') >= 0) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo
}

/**
 * 读 chat.index.json（CL1）。
 * - ENOENT（首建）→ 空列表；
 * - 其余错误（坏 JSON / 形状异常 / 瞬时 IO）→ 短重试一次后抛出，
 *   禁止静默当空列表写回；upsert 路径在调用侧 degrade。
 */
async function readChatListRaw(): Promise<ChatListFile> {
  for (let attempt = 0; ; attempt++) {
    try {
      const raw = await readFile(chatListFile(), 'utf8')
      const j = JSON.parse(raw) as ChatListFile
      if (!j || j.schemaVersion !== 1 || !Array.isArray(j.conversations)) {
        throw new Error('chat.index.json: unexpected shape')
      }
      return j
    } catch (e) {
      if (isErrnoCode(e, 'ENOENT')) {
        return { schemaVersion: 1, conversations: [] }
      }
      if (attempt === 0) {
        await new Promise((r) => setTimeout(r, 15))
        continue
      }
      throw e
    }
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
  if (dirty) {
    list.conversations.sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt, 'en'),
    )
    await writeChatListUnsafe(list)
  }
  // CL4：reconcile 成功（含无新增）即视为磁盘已核对，清 dirty；写失败时保持 dirty
  chatListReconcileDirty = false
  lastChatListReconcileAt = Date.now()
  return dirty
}

export async function reconcileChatListWithDisk(): Promise<boolean> {
  return withChatListFileLock(() => reconcileChatListWithDiskUnsafe())
}

export async function readChatList(): Promise<ChatListFile> {
  return withChatListFileLock(async () => {
    // CL4：reconcile 仅 dirty / 超时兜底触发，不再每次读列表全盘扫描
    const now = Date.now()
    if (
      chatListReconcileDirty ||
      now - lastChatListReconcileAt >= CHAT_LIST_RECONCILE_MIN_INTERVAL_MS
    ) {
      await reconcileChatListWithDiskUnsafe()
    }
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

export interface ChatListTurnStats {
  /** 绝对 active 路径轮数（首写 / 导入等已知总数；与 appendedTurnCount 二选一） */
  turnCount?: number
  /** 追加到 active 路径的增量轮数（与 turnCount 二选一） */
  appendedTurnCount?: number
  /** 本次写盘末轮 createdAt（active 路径语义）；空则 count>0 时回退 updatedAt */
  lastChatAt: string | null
}

/** CL5：把写事件统计折进条目（enrich 前调用以免 needsCount/needsLast 触发全链扫描） */
function applyTurnStatsToEntry(
  entry: ChatListEntry,
  s: ChatListTurnStats,
  prevActiveTurnCount: number | undefined,
): ChatListEntry {
  const count =
    s.turnCount !== undefined
      ? s.turnCount
      : (prevActiveTurnCount ?? 0) + (s.appendedTurnCount ?? 0)
  const providedLast = s.lastChatAt?.trim() || null
  const last = providedLast ?? (count > 0 ? entry.updatedAt : undefined)
  const { lastChatAt: _drop, ...rest } = entry
  return {
    ...rest,
    activeTurnCount: count,
    ...(last ? { lastChatAt: last } : {}),
  }
}

export async function upsertChatListEntry(
  entry: ChatListEntry,
  source?: ConversationIndex,
  options?: {
    refreshConversationStats?: boolean
    /** CL5：写事件统计，热路径避免全链扫描（口径见 DOC/devNotes/52 §6 D2） */
    turnStats?: ChatListTurnStats
  },
): Promise<void> {
  const { enrichChatListEntry, listLastChatAtFromStats } = await import(
    './character-storage.js',
  )
  // CL6 阶段 1（锁内）：读列表 + 兜底统计折叠（供 enrich 判定 needsCount/needsLast）
  const merged = await withChatListFileLock(async () => {
    let list: ChatListFile
    try {
      list = await readChatListRaw()
    } catch (e) {
      // CL1 degrade：读失败不写空列表，标记待 reconcile，下次读列表自愈
      console.warn('[chat-list] upsert skipped: cannot read chat.index.json', e)
      chatListReconcileDirty = true
      return null
    }
    const existing = list.conversations.find(
      (c) => c.conversationId === entry.conversationId,
    )
    return {
      ...entry,
      activeTurnCount: entry.activeTurnCount ?? existing?.activeTurnCount,
      lastChatAt: entry.lastChatAt ?? existing?.lastChatAt,
    }
  })
  if (!merged) return

  // CL5：在 enrich 前写入统计，避免 enrich 因缺 count/last 触发全链扫描
  let preEnrich: ChatListEntry = merged
  if (options?.turnStats) {
    preEnrich = applyTurnStatsToEntry(
      merged,
      options.turnStats,
      merged.activeTurnCount,
    )
  } else if (options?.refreshConversationStats) {
    try {
      const stats = await resolveActivePathConversationStats(
        merged.conversationId,
      )
      const resolvedLast = listLastChatAtFromStats(stats, merged.updatedAt)
      const { lastChatAt: _drop, ...rest } = merged
      preEnrich = {
        ...rest,
        activeTurnCount: stats.turnCount,
        ...(resolvedLast ? { lastChatAt: resolvedLast } : {}),
      }
    } catch {
      // 保留 merged 已有统计
    }
  }

  // CL6 阶段 2（锁外）：角色卡元数据 enrich（不阻塞列表锁）
  const enriched = await enrichChatListEntry(preEnrich, source)

  // CL6 阶段 3（锁内）：以新鲜 prev 重算 turnStats → 合并 → 有序插入 → 写
  await withChatListFileLock(async () => {
    let list: ChatListFile
    try {
      list = await readChatListRaw()
    } catch (e) {
      console.warn('[chat-list] upsert skipped: cannot read chat.index.json', e)
      chatListReconcileDirty = true
      return
    }
    const i = list.conversations.findIndex(
      (c) => c.conversationId === enriched.conversationId,
    )
    const prev = i >= 0 ? list.conversations[i]! : undefined
    let final: ChatListEntry = enriched
    if (options?.turnStats) {
      // 增量基数用阶段 3 新鲜 prev，避免锁外期间统计漂移
      final = applyTurnStatsToEntry(
        enriched,
        options.turnStats,
        prev?.activeTurnCount,
      )
    }
    // refreshConversationStats 已在 enrich 前算完并带入 enriched，此处不再锁内全链扫描
    if (i >= 0) {
      if (chatListEntryEqual(prev!, final)) {
        // CL2：无字段变化跳过整写（对齐 syncChatListConversationStats 先例）
        return
      }
      if (prev!.updatedAt === final.updatedAt) {
        // CL9：更新时间未变则原位替换，保持已排序
        list.conversations[i] = final
      } else {
        // CL9：更新时间变化 → 移除后按 updatedAt 二分插入（替代全量 sort）
        list.conversations.splice(i, 1)
        list.conversations.splice(
          chatListSortedInsertIndex(list.conversations, final),
          0,
          final,
        )
      }
    } else {
      // CL9：新条目按 updatedAt 二分插入
      list.conversations.splice(
        chatListSortedInsertIndex(list.conversations, final),
        0,
        final,
      )
    }
    await writeChatListUnsafe(list)
  })
}
export async function updateConversationIndexAndList(
  conversationId: string,
  mutator: (
    idx: ConversationIndex,
  ) =>
    | ConversationIndex
    | null
    | Promise<ConversationIndex | null>,
  listOpts?: { refreshConversationStats?: boolean; turnStats?: ChatListTurnStats },
): Promise<ConversationIndex | null> {
  const next = await mutateConversationIndex(conversationId, mutator)
  if (!next) return null
  await upsertChatListEntry(chatListEntryFromIndex(next), next, listOpts)
  return next
}

export async function upsertChatListEntries(
  entries: ChatListEntry[],
  sources?: (ConversationIndex | undefined)[],
): Promise<void> {
  if (entries.length === 0) return
  const { enrichChatListEntry } = await import('./character-storage.js')
  await withChatListFileLock(async () => {
    let list: ChatListFile
    try {
      list = await readChatListRaw()
    } catch (e) {
      console.warn('[chat-list] batch upsert skipped: cannot read chat.index.json', e)
      chatListReconcileDirty = true
      return
    }
    const current = new Map(list.conversations.map((c) => [c.conversationId, c]))
    let changed = false
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!
      const existing = current.get(entry.conversationId)
      const merged: ChatListEntry = {
        ...entry,
        activeTurnCount: entry.activeTurnCount ?? existing?.activeTurnCount,
        lastChatAt: entry.lastChatAt ?? existing?.lastChatAt,
      }
      const enriched = await enrichChatListEntry(merged, sources?.[i])
      const prev = current.get(enriched.conversationId)
      if (prev && chatListEntryEqual(prev, enriched)) continue
      current.set(enriched.conversationId, enriched)
      changed = true
    }
    if (!changed) return
    list.conversations = [...current.values()]
    list.conversations.sort((a, b) =>
      b.updatedAt.localeCompare(a.updatedAt, 'en'),
    )
    await writeChatListUnsafe(list)
  })
}

/** 会话删除后从列表移除条目（锁内 reconcile 一次保证列表完整） */
export async function removeChatListEntry(conversationId: string): Promise<void> {
  const id = conversationId.trim()
  if (!id) return
  await withChatListFileLock(async () => {
    await reconcileChatListWithDiskUnsafe()
    const list = await readChatListRaw()
    list.conversations = list.conversations.filter((c) => c.conversationId !== id)
    await writeChatListUnsafe(list)
  })
}
