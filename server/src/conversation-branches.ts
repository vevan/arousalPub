import { access, mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { ApiErrorCodes } from './api-error-codes.js'
import {
  chatListEntryFromIndex,
  conversationDir,
  mutateConversationIndex,
  readBranchConversationIndex,
  readConversationIndex,
  upsertChatListEntry,
  writeBranchConversationIndex,
  writeChunkFile,
  writeConversationIndex,
  type ChunkFile,
  type ConversationIndex,
  type TurnRecord,
} from './chat-storage.js'
import {
  collectRegisteredBranchPaths,
  enumerateAllChunkChains,
  findBranchRegistryEntry,
  isBranchRegistryBrokenError,
  parseBranchRegistryForkTurnId,
  parseBranchRegistryPath,
  readAllTurnsAtBranchPath,
  readChunkContainingOrdinal,
  readChunkFileAt,
  readConversationActiveBranchPath,
  resolveActivePathTurns,
  invalidateChunkIndexSyncCache,
} from './chunk-chain.js'
import { chunkStorageRelativePath, normalizeBranchPath, resolveNestedBranchPath } from './chunk-path.js'
import { deleteTurnMemoryByBranchSubtree } from './memory-store.js'

export interface BranchRegistryEntry {
  forkTurnId: string
  path: string
  forkMessageId?: string
  label?: string
}

export interface CreateBranchResult {
  path: string
  forkTurnId: string
  forkOrdinal: number
  activeBranchPath: string
}

export interface DeleteBranchResult {
  path: string
  activeBranchPath: string
  memoryCleanupFailed?: boolean
  activeResetFailed?: boolean
  /** 注册表已清理但子树目录删除失败（可重试 DELETE） */
  dirCleanupFailed?: boolean
  /** 注册表已无条目，仅清理遗留目录（`dirCleanupFailed` 后重试） */
  orphanDirCleanup?: boolean
}

export interface UpdateBranchLabelResult {
  path: string
  label?: string
}

export interface BranchTreeNodeDto {
  path: string
  label?: string
  forkTurnId: string | null
  forkOrdinal: number | null
  forkMessageId?: string
  /** 该分支子树内独有 turn 数（不含共享前缀） */
  turnCount: number
  /** 沿 active 路径合并后的总 turn 数（含 fork 点前缀） */
  mergedTurnCount?: number
  children: BranchTreeNodeDto[]
}

export interface BranchTreeResponse {
  activeBranchPath: string
  nodes: BranchTreeNodeDto[]
}

type BranchOpError = {
  error: (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes]
  status: number
}

export const BRANCH_LABEL_MAX_LENGTH = 64

/** 规范化分支展示名；空串/null 表示清除 label */
export function normalizeBranchLabelInput(
  raw: unknown,
  options?: { optional?: boolean },
): { label: string | null } | BranchOpError {
  if (raw === undefined || raw === null) {
    if (options?.optional) return { label: null }
    return { error: ApiErrorCodes.validation_failed, status: 400 }
  }
  if (typeof raw !== 'string') {
    return { error: ApiErrorCodes.branch_label_invalid, status: 400 }
  }
  const trimmed = raw.trim()
  if (!trimmed) return { label: null }
  if (trimmed.length > BRANCH_LABEL_MAX_LENGTH) {
    return { error: ApiErrorCodes.branch_label_invalid, status: 400 }
  }
  return { label: trimmed }
}

function nowIso(): string {
  return new Date().toISOString()
}

const branchCreateLocks = new Map<string, Promise<void>>()

async function withBranchCreateLock<T>(
  conversationId: string,
  parentBranchPath: string,
  fn: () => Promise<T>,
): Promise<T> {
  const key = `${conversationId}:${normalizeBranchPath(parentBranchPath)}`
  const prev = branchCreateLocks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const chained = prev.then(() => gate)
  branchCreateLocks.set(key, chained)
  await prev
  try {
    return await fn()
  } finally {
    release()
    if (branchCreateLocks.get(key) === chained) {
      branchCreateLocks.delete(key)
    }
  }
}

async function readBranchForkTurnIds(conversationId: string): Promise<string[]> {
  const idx = await readConversationIndex(conversationId)
  if (!Array.isArray(idx?.branchForkTurnIds)) return []
  return idx.branchForkTurnIds.filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0,
  )
}

async function writeBranchForkTurnIds(
  conversationId: string,
  ids: string[],
): Promise<void> {
  const unique = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  const next = await mutateConversationIndex(conversationId, (idx) => ({
    ...idx,
    branchForkTurnIds: unique,
    updatedAt: nowIso(),
  }))
  if (!next) return
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
}

async function addBranchForkTurnIdToIndex(
  conversationId: string,
  forkTurnId: string,
): Promise<void> {
  const tid = forkTurnId.trim()
  if (!tid) return
  const current = await readBranchForkTurnIds(conversationId)
  if (current.includes(tid)) return
  await writeBranchForkTurnIds(conversationId, [...current, tid])
}

async function removeBranchForkTurnIdFromIndex(
  conversationId: string,
  forkTurnId: string,
): Promise<void> {
  const tid = forkTurnId.trim()
  if (!tid) return
  const current = await readBranchForkTurnIds(conversationId)
  if (!current.includes(tid)) return
  await writeBranchForkTurnIds(
    conversationId,
    current.filter((id) => id !== tid),
  )
}

/** 从注册表重建 fork turnId 索引（repair 用） */
export async function rebuildBranchForkTurnIdIndex(
  conversationId: string,
): Promise<string[]> {
  const paths = await collectRegisteredBranchPaths(conversationId)
  const ids: string[] = []
  for (const fullPath of paths) {
    let parent: string
    let segment: string
    try {
      ;({ parent, segment } = parentPathAndSegment(fullPath))
    } catch {
      continue
    }
    const entry = await findBranchRegistryEntry(conversationId, parent, segment)
    const forkTurnId = entry ? parseBranchRegistryForkTurnId(entry) : null
    if (forkTurnId) ids.push(forkTurnId)
  }
  const unique = [...new Set(ids)]
  await writeBranchForkTurnIds(conversationId, unique)
  return unique
}

async function branchDirExists(branchDir: string): Promise<boolean> {
  try {
    await access(branchDir)
    return true
  } catch {
    return false
  }
}

/** 在 parent 下分配 `branchN` 段名（未占用） */
export function allocateBranchSegmentName(existingPaths: string[]): string | null {
  const used = new Set(
    existingPaths
      .map((p) => p.trim())
      .filter(Boolean)
      .map((p) => p.split('/').pop() ?? p),
  )
  for (let i = 1; i <= 9999; i++) {
    const name = `branch${i}`
    if (!used.has(name)) return name
  }
  return null
}

function parseBranchRegistryLabel(entry: unknown): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined
  const raw = (entry as { label?: unknown }).label
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  return raw.trim()
}

function parseBranchRegistryForkMessageId(entry: unknown): string | undefined {
  if (!entry || typeof entry !== 'object') return undefined
  const raw = (entry as { forkMessageId?: unknown }).forkMessageId
  if (typeof raw !== 'string' || !raw.trim()) return undefined
  return raw.trim()
}

function branchRegistryEntryFromRaw(entry: unknown): BranchRegistryEntry | null {
  const forkTurnId = parseBranchRegistryForkTurnId(entry)
  const relPath = parseBranchRegistryPath(entry)
  if (!forkTurnId || !relPath) return null
  const out: BranchRegistryEntry = { forkTurnId, path: relPath }
  const forkMessageId = parseBranchRegistryForkMessageId(entry)
  if (forkMessageId) out.forkMessageId = forkMessageId
  const label = parseBranchRegistryLabel(entry)
  if (label) out.label = label
  return out
}

async function readParentConversationIndex(
  conversationId: string,
  parentBranchPath: string,
): Promise<ConversationIndex | null> {
  const parent = normalizeBranchPath(parentBranchPath)
  if (!parent) return readConversationIndex(conversationId)
  return readBranchConversationIndex(conversationId, parent)
}

async function listSiblingBranchSegments(
  conversationId: string,
  parentBranchPath: string,
): Promise<string[]> {
  const idx = await readParentConversationIndex(conversationId, parentBranchPath)
  if (!Array.isArray(idx?.branches)) return []
  const out: string[] = []
  for (const entry of idx.branches) {
    const p = parseBranchRegistryPath(entry)
    if (p) out.push(p)
  }
  return out
}

function branchIndexStubFromRoot(root: ConversationIndex): ConversationIndex {
  const t = nowIso()
  return {
    schemaVersion: 1,
    conversationId: root.conversationId,
    title: root.title,
    ...(root.characterIds?.length ? { characterIds: root.characterIds } : {}),
    createdAt: t,
    updatedAt: t,
    headChunkFile: null,
    tailChunkFile: null,
    branches: [],
  }
}

async function appendBranchRegistryToParentIndex(
  conversationId: string,
  parentBranchPath: string,
  entry: BranchRegistryEntry,
): Promise<ConversationIndex | null> {
  return upsertBranchRegistryInParentIndex(conversationId, parentBranchPath, entry)
}

async function upsertBranchRegistryInParentIndex(
  conversationId: string,
  parentBranchPath: string,
  entry: BranchRegistryEntry,
): Promise<ConversationIndex | null> {
  const parent = normalizeBranchPath(parentBranchPath)
  if (parent) {
    const idx = await readParentConversationIndex(conversationId, parent)
    if (!idx) return null
    const branches = Array.isArray(idx.branches) ? idx.branches.slice() : []
    const existingIdx = branches.findIndex((e) =>
      registryEntryMatchesSegment(e, entry.path),
    )
    if (existingIdx >= 0) {
      branches[existingIdx] = entry
    } else {
      branches.push(entry)
    }
    const next: ConversationIndex = {
      ...idx,
      branches,
      updatedAt: nowIso(),
    }
    await writeBranchConversationIndex(conversationId, parent, next)
    return next
  }
  return mutateConversationIndex(conversationId, (idx) => {
    const branches = Array.isArray(idx.branches) ? idx.branches.slice() : []
    const existingIdx = branches.findIndex((e) =>
      registryEntryMatchesSegment(e, entry.path),
    )
    if (existingIdx >= 0) {
      branches[existingIdx] = entry
    } else {
      branches.push(entry)
    }
    return {
      ...idx,
      branches,
      updatedAt: nowIso(),
    }
  })
}

async function appendBranchRegistryToForkChunk(
  conversationId: string,
  chunkBranchPath: string,
  chunkFileName: string,
  entry: BranchRegistryEntry,
): Promise<boolean> {
  return upsertBranchRegistryInForkChunk(
    conversationId,
    chunkBranchPath,
    chunkFileName,
    entry,
    { replaceOnly: false },
  )
}

async function upsertBranchRegistryInForkChunk(
  conversationId: string,
  chunkBranchPath: string,
  chunkFileName: string,
  entry: BranchRegistryEntry,
  opts?: { replaceOnly?: boolean },
): Promise<boolean> {
  const bp = normalizeBranchPath(chunkBranchPath)
  const chunk = await readChunkFileAt(conversationId, bp, chunkFileName)
  if (!chunk) return false
  const links = chunk.meta.links ?? {
    previous: null,
    next: null,
    branches: [],
  }
  const branches = Array.isArray(links.branches) ? links.branches.slice() : []
  const existingIdx = branches.findIndex((e) =>
    registryEntryMatchesSegment(e, entry.path),
  )
  if (existingIdx >= 0) {
    branches[existingIdx] = entry
  } else if (opts?.replaceOnly) {
    return false
  } else {
    branches.push(entry)
  }
  const nextChunk: ChunkFile = {
    ...chunk,
    meta: {
      ...chunk.meta,
      links: {
        previous: links.previous ?? null,
        next: links.next ?? null,
        branches,
      },
    },
  }
  await writeChunkFile(conversationId, chunkStorageRelativePath(bp, chunkFileName), nextChunk)
  return true
}

function parentPathAndSegment(fullPath: string): {
  parent: string
  segment: string
} {
  const bp = normalizeBranchPath(fullPath)
  const parts = bp.split('/').filter(Boolean)
  const segment = parts.pop()
  if (!segment) {
    throw new Error('invalid branch path segment')
  }
  return { parent: parts.join('/'), segment }
}

function registryEntryMatchesSegment(entry: unknown, segment: string): boolean {
  const rel = parseBranchRegistryPath(entry)
  if (!rel) return false
  return rel === segment || rel.split('/').pop() === segment
}

async function removeBranchRegistryFromParentIndex(
  conversationId: string,
  parentBranchPath: string,
  segment: string,
): Promise<ConversationIndex | null> {
  const parent = normalizeBranchPath(parentBranchPath)
  if (parent) {
    const idx = await readParentConversationIndex(conversationId, parent)
    if (!idx) return null
    const branches = Array.isArray(idx.branches) ? idx.branches : []
    const nextBranches = branches.filter(
      (e) => !registryEntryMatchesSegment(e, segment),
    )
    if (nextBranches.length === branches.length) return null
    const next: ConversationIndex = {
      ...idx,
      branches: nextBranches,
      updatedAt: nowIso(),
    }
    await writeBranchConversationIndex(conversationId, parent, next)
    return next
  }
  return mutateConversationIndex(conversationId, (idx) => {
    const branches = Array.isArray(idx.branches) ? idx.branches : []
    const nextBranches = branches.filter(
      (e) => !registryEntryMatchesSegment(e, segment),
    )
    if (nextBranches.length === branches.length) return null
    return {
      ...idx,
      branches: nextBranches,
      updatedAt: nowIso(),
    }
  })
}

async function removeBranchRegistryFromForkChunk(
  conversationId: string,
  parentBranchPath: string,
  segment: string,
  forkTurnId: string,
): Promise<boolean> {
  const parent = normalizeBranchPath(parentBranchPath)
  const parentTurns =
    parent === ''
      ? await readAllTurnsAtBranchPath(conversationId, '')
      : await resolveActivePathTurns(conversationId, parent)
  const forkTurn = parentTurns.find((t) => t.turnId === forkTurnId)
  if (!forkTurn) return false

  const located = await readChunkContainingOrdinal(
    conversationId,
    forkTurn.turnOrdinal,
    parent,
  )
  if (!located) return false

  const chunk = await readChunkFileAt(
    conversationId,
    located.branchPath,
    located.fileName,
  )
  if (!chunk) return false

  const links = chunk.meta.links ?? {
    previous: null,
    next: null,
    branches: [],
  }
  const branches = Array.isArray(links.branches) ? links.branches : []
  const nextBranches = branches.filter((e) => !registryEntryMatchesSegment(e, segment))
  if (nextBranches.length === branches.length) return false

  const nextChunk: ChunkFile = {
    ...chunk,
    meta: {
      ...chunk.meta,
      links: {
        previous: links.previous ?? null,
        next: links.next ?? null,
        branches: nextBranches,
      },
    },
  }
  await writeChunkFile(
    conversationId,
    chunkStorageRelativePath(located.branchPath, located.fileName),
    nextChunk,
  )
  return true
}

function branchRegistryEntryWithLabel(
  entry: unknown,
  label: string | null,
): BranchRegistryEntry | null {
  const parsed = branchRegistryEntryFromRaw(entry)
  if (!parsed) return null
  const next: BranchRegistryEntry = {
    forkTurnId: parsed.forkTurnId,
    path: parsed.path,
  }
  if (parsed.forkMessageId) next.forkMessageId = parsed.forkMessageId
  if (label) next.label = label
  return next
}

async function updateBranchRegistryInParentIndex(
  conversationId: string,
  parentBranchPath: string,
  segment: string,
  label: string | null,
): Promise<ConversationIndex | null> {
  const parent = normalizeBranchPath(parentBranchPath)
  if (parent) {
    const idx = await readParentConversationIndex(conversationId, parent)
    if (!idx) return null
    const branches = Array.isArray(idx.branches) ? idx.branches : []
    let changed = false
    const nextBranches = branches.map((e) => {
      if (!registryEntryMatchesSegment(e, segment)) return e
      const next = branchRegistryEntryWithLabel(e, label)
      if (!next) return e
      changed = true
      return next
    })
    if (!changed) return null
    const next: ConversationIndex = {
      ...idx,
      branches: nextBranches,
      updatedAt: nowIso(),
    }
    await writeBranchConversationIndex(conversationId, parent, next)
    return next
  }
  return mutateConversationIndex(conversationId, (idx) => {
    const branches = Array.isArray(idx.branches) ? idx.branches : []
    let changed = false
    const nextBranches = branches.map((e) => {
      if (!registryEntryMatchesSegment(e, segment)) return e
      const next = branchRegistryEntryWithLabel(e, label)
      if (!next) return e
      changed = true
      return next
    })
    if (!changed) return null
    return {
      ...idx,
      branches: nextBranches,
      updatedAt: nowIso(),
    }
  })
}

async function updateBranchRegistryInForkChunk(
  conversationId: string,
  parentBranchPath: string,
  segment: string,
  forkTurnId: string,
  label: string | null,
): Promise<boolean> {
  const parent = normalizeBranchPath(parentBranchPath)
  const parentTurns =
    parent === ''
      ? await readAllTurnsAtBranchPath(conversationId, '')
      : await resolveActivePathTurns(conversationId, parent)
  const forkTurn = parentTurns.find((t) => t.turnId === forkTurnId)
  if (!forkTurn) return false

  const located = await readChunkContainingOrdinal(
    conversationId,
    forkTurn.turnOrdinal,
    parent,
  )
  if (!located) return false

  const chunk = await readChunkFileAt(
    conversationId,
    located.branchPath,
    located.fileName,
  )
  if (!chunk) return false

  const links = chunk.meta.links ?? {
    previous: null,
    next: null,
    branches: [],
  }
  const branches = Array.isArray(links.branches) ? links.branches : []
  let changed = false
  const nextBranches = branches.map((e) => {
    if (!registryEntryMatchesSegment(e, segment)) return e
    const next = branchRegistryEntryWithLabel(e, label)
    if (!next) return e
    changed = true
    return next
  })
  if (!changed) return false

  const nextChunk: ChunkFile = {
    ...chunk,
    meta: {
      ...chunk.meta,
      links: {
        previous: links.previous ?? null,
        next: links.next ?? null,
        branches: nextBranches,
      },
    },
  }
  await writeChunkFile(
    conversationId,
    chunkStorageRelativePath(located.branchPath, located.fileName),
    nextChunk,
  )
  return true
}

async function resolveForkChunkLocationForRegistry(
  conversationId: string,
  parentBranchPath: string,
  forkTurnId: string,
): Promise<{ branchPath: string; fileName: string } | null> {
  const parent = normalizeBranchPath(parentBranchPath)
  const parentTurns =
    parent === ''
      ? await readAllTurnsAtBranchPath(conversationId, '')
      : await resolveActivePathTurns(conversationId, parent)
  const forkTurn = parentTurns.find((t) => t.turnId === forkTurnId)
  if (!forkTurn) return null
  const located = await readChunkContainingOrdinal(
    conversationId,
    forkTurn.turnOrdinal,
    parent,
  )
  if (!located) return null
  return { branchPath: located.branchPath, fileName: located.fileName }
}

export type DeleteBranchRegistryRollbackResult = {
  ok: boolean
  parentRestored: boolean
  forkChunkRestored: boolean
}

/**
 * DELETE 在父 index 已移除、fork chunk 更新失败时恢复双写注册表（集成测 / 运维可观测）。
 */
export async function rollbackDeleteBranchRegistry(
  conversationId: string,
  params: {
    parentBranchPath: string
    segment: string
    savedEntry: BranchRegistryEntry
    chunkBranchPath: string
    chunkFileName: string
  },
): Promise<DeleteBranchRegistryRollbackResult> {
  const parentRestored = !!(await upsertBranchRegistryInParentIndex(
    conversationId,
    params.parentBranchPath,
    params.savedEntry,
  ))
  if (!parentRestored) {
    return { ok: false, parentRestored: false, forkChunkRestored: false }
  }

  const forkChunkRestored = await appendBranchRegistryToForkChunk(
    conversationId,
    params.chunkBranchPath,
    params.chunkFileName,
    params.savedEntry,
  )
  if (!forkChunkRestored) {
    await removeBranchRegistryFromParentIndex(
      conversationId,
      params.parentBranchPath,
      params.segment,
    ).catch(() => {})
    return { ok: false, parentRestored: true, forkChunkRestored: false }
  }

  return { ok: true, parentRestored: true, forkChunkRestored: true }
}

async function rollbackCreatedConversationBranch(
  conversationId: string,
  params: {
    parentBranchPath: string
    segment: string
    fullPath: string
    chunkBranchPath: string
    chunkFileName: string
    forkTurnId: string
  },
): Promise<void> {
  await removeBranchRegistryFromForkChunk(
    conversationId,
    params.parentBranchPath,
    params.segment,
    params.forkTurnId,
  ).catch(() => {})
  await removeBranchRegistryFromParentIndex(
    conversationId,
    params.parentBranchPath,
    params.segment,
  ).catch(() => {})
  await removeBranchForkTurnIdFromIndex(conversationId, params.forkTurnId).catch(
    () => {},
  )
  await rebuildBranchForkTurnIdIndex(conversationId).catch(() => {})
  const branchDir = path.join(
    conversationDir(conversationId),
    ...params.fullPath.split('/'),
  )
  await rm(branchDir, { recursive: true, force: true }).catch(() => {})
}

/** 扫描注册表：turnId 是否为任一已注册分支的 fork 点 */
async function scanRegistryForForkTurnId(
  conversationId: string,
  turnId: string,
): Promise<boolean> {
  const paths = await collectRegisteredBranchPaths(conversationId)
  for (const fullPath of paths) {
    let parent: string
    let segment: string
    try {
      ;({ parent, segment } = parentPathAndSegment(fullPath))
    } catch {
      continue
    }
    const entry = await findBranchRegistryEntry(conversationId, parent, segment)
    const forkTurnId = entry ? parseBranchRegistryForkTurnId(entry) : null
    if (forkTurnId === turnId) return true
  }
  return false
}

/** turnId 是否为某已注册分支的 fork 点 */
export async function isTurnIdReferencedByBranchRegistry(
  conversationId: string,
  turnId: string,
): Promise<boolean> {
  const tid = turnId.trim()
  if (!tid) return false
  const referenced = await scanRegistryForForkTurnId(conversationId, tid)
  const indexed = await readBranchForkTurnIds(conversationId)
  const inIndex = indexed.includes(tid)
  if (referenced !== inIndex) {
    await rebuildBranchForkTurnIdIndex(conversationId).catch(() => {})
  }
  return referenced
}

function activePathWithinDeletedSubtree(
  active: string,
  deletedPath: string,
): boolean {
  const a = normalizeBranchPath(active)
  const d = normalizeBranchPath(deletedPath)
  if (!a || !d) return false
  return a === d || a.startsWith(`${d}/`)
}

async function branchPathIsRegistered(
  conversationId: string,
  fullPath: string,
): Promise<boolean> {
  const target = normalizeBranchPath(fullPath)
  if (!target) return true
  const registered = await collectRegisteredBranchPaths(conversationId)
  return registered.includes(target)
}

/**
 * 空分支 + 从下一轮继续：注册表 + 空 branch index；可选切换 activeBranchPath。
 */
export async function createEmptyConversationBranch(params: {
  conversationId: string
  forkTurnId: string
  forkMessageId?: string | null
  label?: string | null
  setActive?: boolean
}): Promise<CreateBranchResult | BranchOpError> {
  const conversationId = params.conversationId.trim()
  const forkTurnId = params.forkTurnId.trim()
  if (!conversationId || !forkTurnId) {
    return { error: ApiErrorCodes.validation_failed, status: 400 }
  }

  const rootIdx = await readConversationIndex(conversationId)
  if (!rootIdx) {
    return { error: ApiErrorCodes.conversation_not_found, status: 404 }
  }

  const parentBranchPath = await readConversationActiveBranchPath(conversationId)
  let onActive: Awaited<ReturnType<typeof resolveActivePathTurns>>
  try {
    onActive = await resolveActivePathTurns(conversationId, parentBranchPath)
  } catch (e) {
    if (isBranchRegistryBrokenError(e)) {
      return { error: ApiErrorCodes.branch_registry_broken, status: 409 }
    }
    throw e
  }
  const forkTurn = onActive.find((t) => t.turnId === forkTurnId)
  if (!forkTurn) {
    return { error: ApiErrorCodes.fork_turn_not_on_active_path, status: 400 }
  }

  const located = await readChunkContainingOrdinal(
    conversationId,
    forkTurn.turnOrdinal,
    parentBranchPath,
  )
  if (!located) {
    return { error: ApiErrorCodes.fork_turn_not_found, status: 404 }
  }

  return withBranchCreateLock(conversationId, parentBranchPath, async () => {
  const siblings = await listSiblingBranchSegments(conversationId, parentBranchPath)
  const segment = allocateBranchSegmentName(siblings)
  if (!segment) {
    return { error: ApiErrorCodes.branch_path_conflict, status: 409 }
  }

  const fullPath = resolveNestedBranchPath(parentBranchPath, segment)
  const branchDir = path.join(conversationDir(conversationId), ...fullPath.split('/'))
  try {
    await mkdir(branchDir, { recursive: true })
  } catch {
    return { error: ApiErrorCodes.branch_path_conflict, status: 409 }
  }

  const entry: BranchRegistryEntry = {
    forkTurnId,
    path: segment,
  }
  if (typeof params.forkMessageId === 'string' && params.forkMessageId.trim()) {
    entry.forkMessageId = params.forkMessageId.trim()
  }
  const labelNorm = normalizeBranchLabelInput(params.label, { optional: true })
  if ('error' in labelNorm) return labelNorm
  if (labelNorm.label) {
    entry.label = labelNorm.label
  }

  const parentUpdated = await appendBranchRegistryToParentIndex(
    conversationId,
    parentBranchPath,
    entry,
  )
  if (!parentUpdated) {
    await rm(branchDir, { recursive: true, force: true }).catch(() => {})
    return { error: ApiErrorCodes.branch_create_failed, status: 500 }
  }

  const chunkUpdated = await appendBranchRegistryToForkChunk(
    conversationId,
    located.branchPath,
    located.fileName,
    entry,
  )
  if (!chunkUpdated) {
    await removeBranchRegistryFromParentIndex(
      conversationId,
      parentBranchPath,
      segment,
    ).catch(() => {})
    await rm(branchDir, { recursive: true, force: true }).catch(() => {})
    return { error: ApiErrorCodes.branch_create_failed, status: 500 }
  }

  try {
    const branchIdx = branchIndexStubFromRoot(rootIdx)
    await writeBranchConversationIndex(conversationId, fullPath, branchIdx)
  } catch {
    await removeBranchRegistryFromForkChunk(
      conversationId,
      located.branchPath,
      segment,
      forkTurnId,
    ).catch(() => {})
    await removeBranchRegistryFromParentIndex(
      conversationId,
      parentBranchPath,
      segment,
    ).catch(() => {})
    await rm(branchDir, { recursive: true, force: true }).catch(() => {})
    return { error: ApiErrorCodes.branch_create_failed, status: 500 }
  }

  await addBranchForkTurnIdToIndex(conversationId, forkTurnId).catch(() => {})
  await rebuildBranchForkTurnIdIndex(conversationId).catch(() => {})

  const setActive = params.setActive !== false
  let activeBranchPath = parentBranchPath
  const rollbackCtx = {
    parentBranchPath,
    segment,
    fullPath,
    chunkBranchPath: located.branchPath,
    chunkFileName: located.fileName,
    forkTurnId,
  }
  if (setActive) {
    try {
      const nextRoot = await mutateConversationIndex(conversationId, (currentRoot) => ({
        ...currentRoot,
        activeBranchPath: fullPath,
        updatedAt: nowIso(),
      }))
      if (!nextRoot) {
        await rollbackCreatedConversationBranch(conversationId, rollbackCtx)
        return { error: ApiErrorCodes.branch_create_failed, status: 500 }
      }
      await upsertChatListEntry(chatListEntryFromIndex(nextRoot), nextRoot)
      activeBranchPath = fullPath
    } catch {
      await rollbackCreatedConversationBranch(conversationId, rollbackCtx)
      return { error: ApiErrorCodes.branch_create_failed, status: 500 }
    }
  }

  return {
    path: fullPath,
    forkTurnId,
    forkOrdinal: forkTurn.turnOrdinal,
    activeBranchPath,
  }
  })
}

type RegistryChild = { fullPath: string; entry: BranchRegistryEntry }

/** 一次遍历 index.branches[]，按父路径分组子分支（深树避免重复读 index） */
async function loadBranchRegistryChildrenByParent(
  conversationId: string,
): Promise<Map<string, RegistryChild[]>> {
  const childrenByParent = new Map<string, RegistryChild[]>()

  async function walk(
    parentBranchPath: string,
    branches: unknown[] | undefined,
  ): Promise<void> {
    if (!Array.isArray(branches) || branches.length === 0) return
    const parent = normalizeBranchPath(parentBranchPath)
    const list: RegistryChild[] = []
    for (const raw of branches) {
      const parsed = branchRegistryEntryFromRaw(raw)
      if (!parsed) continue
      list.push({
        fullPath: resolveNestedBranchPath(parent, parsed.path),
        entry: parsed,
      })
    }
    if (list.length > 0) {
      childrenByParent.set(parent, list)
    }
    for (const { fullPath } of list) {
      const branchIdx = await readBranchConversationIndex(conversationId, fullPath)
      await walk(fullPath, branchIdx?.branches)
    }
  }

  const root = await readConversationIndex(conversationId)
  await walk('', root?.branches)
  return childrenByParent
}

/** 单次枚举全部 chunk 链，汇总各 branchPath suffix turn 数 */
async function countTurnsByBranchPath(
  conversationId: string,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  for (const loc of await enumerateAllChunkChains(conversationId)) {
    const chunk = await readChunkFileAt(
      conversationId,
      loc.branchPath,
      loc.chunkFileName,
    )
    const n = chunk?.turns?.length ?? 0
    if (n <= 0) continue
    counts.set(loc.branchPath, (counts.get(loc.branchPath) ?? 0) + n)
  }
  if (!counts.has('')) counts.set('', 0)
  return counts
}

/** 按父路径缓存 resolveActivePathTurns，深树每层父路径至多算一次 */
async function buildForkOrdinalByPath(
  conversationId: string,
  childrenByParent: Map<string, RegistryChild[]>,
): Promise<Map<string, number | null>> {
  const mergedCache = new Map<string, TurnRecord[]>()
  const forkOrdinalByPath = new Map<string, number | null>()

  const items = [...childrenByParent.entries()].flatMap(([parent, kids]) =>
    kids.map((k) => ({ parent, ...k })),
  )
  items.sort(
    (a, b) => a.fullPath.split('/').length - b.fullPath.split('/').length,
  )

  for (const { parent, fullPath, entry } of items) {
    const parentKey = normalizeBranchPath(parent)
    let parentMerged = mergedCache.get(parentKey)
    if (!parentMerged) {
      parentMerged = await resolveActivePathTurns(conversationId, parentKey)
      mergedCache.set(parentKey, parentMerged)
    }
    const fork = parentMerged.find((t) => t.turnId === entry.forkTurnId)
    forkOrdinalByPath.set(fullPath, fork?.turnOrdinal ?? null)
  }
  return forkOrdinalByPath
}

function buildBranchTreeNodesFromContext(
  parentBranchPath: string,
  childrenByParent: Map<string, RegistryChild[]>,
  turnCountByPath: Map<string, number>,
  forkOrdinalByPath: Map<string, number | null>,
): BranchTreeNodeDto[] {
  const parent = normalizeBranchPath(parentBranchPath)
  const kids = childrenByParent.get(parent) ?? []
  return kids.map(({ fullPath, entry }) => {
    const turnCount = turnCountByPath.get(fullPath) ?? 0
    const forkOrdinal = forkOrdinalByPath.get(fullPath) ?? null
    const mergedTurnCount =
      forkOrdinal !== null ? forkOrdinal + turnCount : turnCount
    return {
      path: fullPath,
      ...(entry.label ? { label: entry.label } : {}),
      forkTurnId: entry.forkTurnId,
      forkOrdinal,
      ...(entry.forkMessageId ? { forkMessageId: entry.forkMessageId } : {}),
      turnCount,
      mergedTurnCount,
      children: buildBranchTreeNodesFromContext(
        fullPath,
        childrenByParent,
        turnCountByPath,
        forkOrdinalByPath,
      ),
    }
  })
}

async function buildBranchTreeNodes(
  conversationId: string,
  parentBranchPath: string,
): Promise<BranchTreeNodeDto[]> {
  const childrenByParent = await loadBranchRegistryChildrenByParent(conversationId)
  const [turnCountByPath, forkOrdinalByPath] = await Promise.all([
    countTurnsByBranchPath(conversationId),
    buildForkOrdinalByPath(conversationId, childrenByParent),
  ])
  return buildBranchTreeNodesFromContext(
    parentBranchPath,
    childrenByParent,
    turnCountByPath,
    forkOrdinalByPath,
  )
}

export async function getConversationBranchTree(
  conversationId: string,
): Promise<BranchTreeResponse | BranchOpError> {
  const id = conversationId.trim()
  if (!id) {
    return { error: ApiErrorCodes.validation_failed, status: 400 }
  }
  const rootIdx = await readConversationIndex(id)
  if (!rootIdx) {
    return { error: ApiErrorCodes.conversation_not_found, status: 404 }
  }
  const activeBranchPath = await readConversationActiveBranchPath(id)
  try {
    const childrenByParent = await loadBranchRegistryChildrenByParent(id)
    const [turnCountByPath, forkOrdinalByPath] = await Promise.all([
      countTurnsByBranchPath(id),
      buildForkOrdinalByPath(id, childrenByParent),
    ])
    const mainTurnCount = turnCountByPath.get('') ?? 0
    const children = buildBranchTreeNodesFromContext(
      '',
      childrenByParent,
      turnCountByPath,
      forkOrdinalByPath,
    )
    return {
      activeBranchPath,
      nodes: [
        {
          path: '',
          forkTurnId: null,
          forkOrdinal: null,
          turnCount: mainTurnCount,
          mergedTurnCount: mainTurnCount,
          children,
        },
      ],
    }
  } catch (e) {
    if (isBranchRegistryBrokenError(e)) {
      return { error: ApiErrorCodes.branch_registry_broken, status: 409 }
    }
    throw e
  }
}

export async function updateConversationActiveBranchPath(
  conversationId: string,
  activeBranchPath: string | null,
): Promise<ConversationIndex | BranchOpError> {
  const id = conversationId.trim()
  if (!id) {
    return { error: ApiErrorCodes.validation_failed, status: 400 }
  }

  let normalized: string | null = null
  if (activeBranchPath !== null && activeBranchPath !== '') {
    try {
      normalized = normalizeBranchPath(activeBranchPath)
    } catch {
      return { error: ApiErrorCodes.branch_path_not_found, status: 400 }
    }
    if (!(await branchPathIsRegistered(id, normalized))) {
      return { error: ApiErrorCodes.branch_path_not_found, status: 404 }
    }
  }

  const next = await mutateConversationIndex(id, (idx) => {
    const out: ConversationIndex = { ...idx, updatedAt: nowIso() }
    if (normalized === null) {
      delete out.activeBranchPath
    } else {
      out.activeBranchPath = normalized
    }
    return out
  })
  if (!next) {
    return { error: ApiErrorCodes.conversation_not_found, status: 404 }
  }

  await upsertChatListEntry(chatListEntryFromIndex(next), next)
  const { syncChatListConversationStats } = await import('./chat-storage.js')
  await syncChatListConversationStats(id)
  return next
}

/** 更新分支展示名（父 index + fork chunk 注册表双写） */
export async function updateConversationBranchLabel(
  conversationId: string,
  branchPath: string,
  labelInput: unknown,
): Promise<UpdateBranchLabelResult | BranchOpError> {
  const id = conversationId.trim()
  let target: string
  try {
    target = normalizeBranchPath(branchPath)
  } catch {
    return { error: ApiErrorCodes.branch_path_not_found, status: 400 }
  }
  if (!target) {
    return { error: ApiErrorCodes.branch_path_not_found, status: 400 }
  }

  const labelNorm = normalizeBranchLabelInput(labelInput, { optional: true })
  if ('error' in labelNorm) return labelNorm

  const rootIdx = await readConversationIndex(id)
  if (!rootIdx) {
    return { error: ApiErrorCodes.conversation_not_found, status: 404 }
  }
  if (!(await branchPathIsRegistered(id, target))) {
    return { error: ApiErrorCodes.branch_path_not_found, status: 404 }
  }

  let parent: string
  let segment: string
  try {
    ;({ parent, segment } = parentPathAndSegment(target))
  } catch {
    return { error: ApiErrorCodes.branch_path_not_found, status: 400 }
  }

  const registryEntry = await findBranchRegistryEntry(id, parent, segment)
  const forkTurnId = registryEntry
    ? parseBranchRegistryForkTurnId(registryEntry)
    : null
  if (!forkTurnId) {
    return { error: ApiErrorCodes.branch_path_not_found, status: 404 }
  }

  const previousLabel = parseBranchRegistryLabel(registryEntry) ?? null

  const parentUpdated = await updateBranchRegistryInParentIndex(
    id,
    parent,
    segment,
    labelNorm.label,
  )
  if (!parentUpdated) {
    return { error: ApiErrorCodes.branch_update_failed, status: 500 }
  }

  try {
    const chunkUpdated = await updateBranchRegistryInForkChunk(
      id,
      parent,
      segment,
      forkTurnId,
      labelNorm.label,
    )
    if (!chunkUpdated) {
      await updateBranchRegistryInParentIndex(
        id,
        parent,
        segment,
        previousLabel,
      )
      return { error: ApiErrorCodes.branch_update_failed, status: 500 }
    }
  } catch {
    await updateBranchRegistryInParentIndex(
      id,
      parent,
      segment,
      previousLabel,
    )
    return { error: ApiErrorCodes.branch_update_failed, status: 500 }
  }

  invalidateChunkIndexSyncCache(id)
  const result: UpdateBranchLabelResult = { path: target }
  if (labelNorm.label) result.label = labelNorm.label
  return result
}

/**
 * 弃用分支：删子树目录、父级注册表、fork chunk 链接、Lance 行；必要时重置 activeBranchPath。
 */
export async function deleteConversationBranch(
  conversationId: string,
  branchPath: string,
): Promise<DeleteBranchResult | BranchOpError> {
  const id = conversationId.trim()
  let target: string
  try {
    target = normalizeBranchPath(branchPath)
  } catch {
    return { error: ApiErrorCodes.branch_path_not_found, status: 400 }
  }
  if (!target) {
    return { error: ApiErrorCodes.branch_path_not_found, status: 400 }
  }

  const rootIdx = await readConversationIndex(id)
  if (!rootIdx) {
    return { error: ApiErrorCodes.conversation_not_found, status: 404 }
  }
  if (!(await branchPathIsRegistered(id, target))) {
    const orphanDir = path.join(conversationDir(id), ...target.split('/'))
    if (await branchDirExists(orphanDir)) {
      let dirCleanupFailed = false
      try {
        await rm(orphanDir, { recursive: true, force: true })
      } catch {
        dirCleanupFailed = true
      }
      let memoryCleanupFailed = false
      try {
        await deleteTurnMemoryByBranchSubtree(id, target)
      } catch {
        memoryCleanupFailed = true
      }
      invalidateChunkIndexSyncCache(id)
      let activeBranchPath = await readConversationActiveBranchPath(id)
      let activeResetFailed = false
      if (activePathWithinDeletedSubtree(activeBranchPath, target)) {
        let orphanParent = ''
        try {
          ;({ parent: orphanParent } = parentPathAndSegment(target))
        } catch {
          orphanParent = ''
        }
        const reset = await updateConversationActiveBranchPath(id, orphanParent || null)
        if ('error' in reset) {
          activeResetFailed = true
        } else {
          activeBranchPath = await readConversationActiveBranchPath(id)
        }
      }
      await rebuildBranchForkTurnIdIndex(id).catch(() => {})
      const orphanResult: DeleteBranchResult = {
        path: target,
        activeBranchPath,
        orphanDirCleanup: true,
      }
      if (memoryCleanupFailed) orphanResult.memoryCleanupFailed = true
      if (activeResetFailed) orphanResult.activeResetFailed = true
      if (dirCleanupFailed) orphanResult.dirCleanupFailed = true
      return orphanResult
    }
    return { error: ApiErrorCodes.branch_path_not_found, status: 404 }
  }

  let parent: string
  let segment: string
  try {
    ;({ parent, segment } = parentPathAndSegment(target))
  } catch {
    return { error: ApiErrorCodes.branch_path_not_found, status: 400 }
  }

  const registryEntry = await findBranchRegistryEntry(id, parent, segment)
  const forkTurnId = registryEntry
    ? parseBranchRegistryForkTurnId(registryEntry)
    : null
  if (!forkTurnId) {
    return { error: ApiErrorCodes.branch_path_not_found, status: 404 }
  }
  if (!branchRegistryEntryFromRaw(registryEntry)) {
    return { error: ApiErrorCodes.branch_path_not_found, status: 404 }
  }
  const savedEntry = branchRegistryEntryFromRaw(registryEntry)!

  const forkLocated = await resolveForkChunkLocationForRegistry(
    id,
    parent,
    forkTurnId,
  )
  if (!forkLocated) {
    return { error: ApiErrorCodes.branch_delete_failed, status: 500 }
  }

  const parentUpdated = await removeBranchRegistryFromParentIndex(id, parent, segment)
  if (!parentUpdated) {
    return { error: ApiErrorCodes.branch_delete_failed, status: 500 }
  }

  try {
    const chunkUpdated = await removeBranchRegistryFromForkChunk(
      id,
      parent,
      segment,
      forkTurnId,
    )
    if (!chunkUpdated) {
      await rollbackDeleteBranchRegistry(id, {
        parentBranchPath: parent,
        segment,
        savedEntry,
        chunkBranchPath: forkLocated.branchPath,
        chunkFileName: forkLocated.fileName,
      })
      return { error: ApiErrorCodes.branch_delete_failed, status: 500 }
    }
  } catch {
    await rollbackDeleteBranchRegistry(id, {
      parentBranchPath: parent,
      segment,
      savedEntry,
      chunkBranchPath: forkLocated.branchPath,
      chunkFileName: forkLocated.fileName,
    })
    return { error: ApiErrorCodes.branch_delete_failed, status: 500 }
  }

  await removeBranchForkTurnIdFromIndex(id, forkTurnId).catch(() => {})
  await rebuildBranchForkTurnIdIndex(id).catch(() => {})

  const branchDir = path.join(conversationDir(id), ...target.split('/'))
  let dirCleanupFailed = false
  try {
    await rm(branchDir, { recursive: true, force: true })
  } catch {
    dirCleanupFailed = true
  }

  let memoryCleanupFailed = false
  try {
    await deleteTurnMemoryByBranchSubtree(id, target)
  } catch {
    memoryCleanupFailed = true
  }
  invalidateChunkIndexSyncCache(id)

  let activeBranchPath = await readConversationActiveBranchPath(id)
  let activeResetFailed = false
  if (activePathWithinDeletedSubtree(activeBranchPath, target)) {
    const reset = await updateConversationActiveBranchPath(id, parent || null)
    if ('error' in reset) {
      activeResetFailed = true
    } else {
      activeBranchPath = await readConversationActiveBranchPath(id)
    }
  }

  const result: DeleteBranchResult = { path: target, activeBranchPath }
  if (memoryCleanupFailed) result.memoryCleanupFailed = true
  if (activeResetFailed) result.activeResetFailed = true
  if (dirCleanupFailed) result.dirCleanupFailed = true
  return result
}

/**
 * 将父 index.branches[].label 同步到 fork chunk 注册表（repair 用；以 index 为准）。
 */
export async function repairBranchRegistryLabelDrift(
  conversationId: string,
): Promise<{ repaired: number; failed: number; failedPaths: string[] }> {
  const paths = await collectRegisteredBranchPaths(conversationId)
  let repaired = 0
  let failed = 0
  const failedPaths: string[] = []
  for (const fullPath of paths) {
    let parent: string
    let segment: string
    try {
      ;({ parent, segment } = parentPathAndSegment(fullPath))
    } catch {
      continue
    }
    const entry = await findBranchRegistryEntry(conversationId, parent, segment)
    const forkTurnId = entry ? parseBranchRegistryForkTurnId(entry) : null
    if (!forkTurnId) continue
    const label = parseBranchRegistryLabel(entry) ?? null
    const forkLocated = await resolveForkChunkLocationForRegistry(
      conversationId,
      parent,
      forkTurnId,
    )
    if (!forkLocated) continue
    const chunk = await readChunkFileAt(
      conversationId,
      forkLocated.branchPath,
      forkLocated.fileName,
    )
    if (!chunk) continue
    const links = chunk.meta.links ?? { previous: null, next: null, branches: [] }
    const branches = Array.isArray(links.branches) ? links.branches : []
    const current = branches.find((e) => registryEntryMatchesSegment(e, segment))
    const currentLabel = current ? parseBranchRegistryLabel(current) ?? null : null
    if (currentLabel === label) continue
    const updated = await updateBranchRegistryInForkChunk(
      conversationId,
      parent,
      segment,
      forkTurnId,
      label,
    )
    if (updated) repaired += 1
    else {
      failed += 1
      failedPaths.push(fullPath)
    }
  }
  return { repaired, failed, failedPaths }
}
