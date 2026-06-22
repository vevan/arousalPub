import { mkdir, rm } from 'node:fs/promises'
import path from 'node:path'
import { ApiErrorCodes } from './api-error-codes.js'
import {
  chatListEntryFromIndex,
  conversationDir,
  readBranchConversationIndex,
  readConversationIndex,
  upsertChatListEntry,
  writeBranchConversationIndex,
  writeChunkFile,
  writeConversationIndex,
  type ChunkFile,
  type ConversationIndex,
} from './chat-storage.js'
import {
  collectRegisteredBranchPaths,
  findBranchRegistryEntry,
  isBranchRegistryBrokenError,
  parseBranchRegistryForkTurnId,
  parseBranchRegistryPath,
  readAllTurnsAtBranchPath,
  readChunkContainingOrdinal,
  readChunkFileAt,
  readConversationActiveBranchPath,
  resolveActivePathTurns,
  resolveBranchForkOrdinal,
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
  turnCount: number
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
    characterId: root.characterId ?? null,
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
  const parent = normalizeBranchPath(parentBranchPath)
  const idx = await readParentConversationIndex(conversationId, parent)
  if (!idx) return null
  const branches = Array.isArray(idx.branches) ? idx.branches.slice() : []
  branches.push(entry)
  const next: ConversationIndex = {
    ...idx,
    branches,
    updatedAt: nowIso(),
  }
  if (parent) {
    await writeBranchConversationIndex(conversationId, parent, next)
  } else {
    await writeConversationIndex(conversationId, next)
  }
  return next
}

async function appendBranchRegistryToForkChunk(
  conversationId: string,
  chunkBranchPath: string,
  chunkFileName: string,
  entry: BranchRegistryEntry,
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
  branches.push(entry)
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
  const idx = await readParentConversationIndex(conversationId, parent)
  if (!idx) return null
  const branches = Array.isArray(idx.branches) ? idx.branches : []
  const nextBranches = branches.filter((e) => !registryEntryMatchesSegment(e, segment))
  if (nextBranches.length === branches.length) return null
  const next: ConversationIndex = {
    ...idx,
    branches: nextBranches,
    updatedAt: nowIso(),
  }
  if (parent) {
    await writeBranchConversationIndex(conversationId, parent, next)
  } else {
    await writeConversationIndex(conversationId, next)
  }
  return next
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
  if (parent) {
    await writeBranchConversationIndex(conversationId, parent, next)
  } else {
    await writeConversationIndex(conversationId, next)
  }
  return next
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

async function restoreParentConversationIndex(
  conversationId: string,
  parentBranchPath: string,
  idx: ConversationIndex | null,
): Promise<void> {
  if (!idx) return
  const parent = normalizeBranchPath(parentBranchPath)
  if (parent) {
    await writeBranchConversationIndex(conversationId, parent, idx)
  } else {
    await writeConversationIndex(conversationId, idx)
  }
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

async function restoreBranchRegistryAfterDeleteFailure(
  conversationId: string,
  parentBranchPath: string,
  parentIdxBefore: ConversationIndex | null,
  forkLocated: { branchPath: string; fileName: string } | null,
  entry: BranchRegistryEntry,
): Promise<void> {
  await restoreParentConversationIndex(conversationId, parentBranchPath, parentIdxBefore)
  if (forkLocated) {
    await appendBranchRegistryToForkChunk(
      conversationId,
      forkLocated.branchPath,
      forkLocated.fileName,
      entry,
    )
  }
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

  const setActive = params.setActive !== false
  let activeBranchPath = parentBranchPath
  if (setActive) {
    const currentRoot = await readConversationIndex(conversationId)
    if (!currentRoot) {
      return { error: ApiErrorCodes.branch_create_failed, status: 500 }
    }
    const nextRoot: ConversationIndex = {
      ...currentRoot,
      activeBranchPath: fullPath,
      updatedAt: nowIso(),
    }
    await writeConversationIndex(conversationId, nextRoot)
    await upsertChatListEntry(chatListEntryFromIndex(nextRoot), nextRoot)
    activeBranchPath = fullPath
  }

  return {
    path: fullPath,
    forkTurnId,
    forkOrdinal: forkTurn.turnOrdinal,
    activeBranchPath,
  }
}

async function buildBranchTreeNodes(
  conversationId: string,
  parentBranchPath: string,
): Promise<BranchTreeNodeDto[]> {
  const idx = await readParentConversationIndex(conversationId, parentBranchPath)
  if (!Array.isArray(idx?.branches) || idx.branches.length === 0) return []

  const nodes: BranchTreeNodeDto[] = []
  for (const raw of idx.branches) {
    const parsed = branchRegistryEntryFromRaw(raw)
    if (!parsed) continue
    const fullPath = resolveNestedBranchPath(parentBranchPath, parsed.path)
    const forkOrdinal = await resolveBranchForkOrdinal(conversationId, fullPath)
    const turns = await readAllTurnsAtBranchPath(conversationId, fullPath)
    const children = await buildBranchTreeNodes(conversationId, fullPath)
    nodes.push({
      path: fullPath,
      ...(parsed.label ? { label: parsed.label } : {}),
      forkTurnId: parsed.forkTurnId,
      forkOrdinal,
      ...(parsed.forkMessageId ? { forkMessageId: parsed.forkMessageId } : {}),
      turnCount: turns.length,
      children,
    })
  }
  return nodes
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
    const children = await buildBranchTreeNodes(id, '')
    return {
      activeBranchPath,
      nodes: [
        {
          path: '',
          forkTurnId: null,
          forkOrdinal: null,
          turnCount: (await readAllTurnsAtBranchPath(id, '')).length,
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
  const idx = await readConversationIndex(id)
  if (!idx) {
    return { error: ApiErrorCodes.conversation_not_found, status: 404 }
  }

  const next: ConversationIndex = { ...idx, updatedAt: nowIso() }
  if (activeBranchPath === null || activeBranchPath === '') {
    delete next.activeBranchPath
  } else {
    let normalized: string
    try {
      normalized = normalizeBranchPath(activeBranchPath)
    } catch {
      return { error: ApiErrorCodes.branch_path_not_found, status: 400 }
    }
    if (!(await branchPathIsRegistered(id, normalized))) {
      return { error: ApiErrorCodes.branch_path_not_found, status: 404 }
    }
    next.activeBranchPath = normalized
  }

  await writeConversationIndex(id, next)
  await upsertChatListEntry(chatListEntryFromIndex(next), next)
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

  const parentIdxBefore = await readParentConversationIndex(id, parent)
  const deletedEntry = branchRegistryEntryFromRaw(registryEntry)
  if (!deletedEntry) {
    return { error: ApiErrorCodes.branch_path_not_found, status: 404 }
  }
  const forkLocated = await resolveForkChunkLocationForRegistry(
    id,
    parent,
    forkTurnId,
  )

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
      await restoreBranchRegistryAfterDeleteFailure(
        id,
        parent,
        parentIdxBefore,
        forkLocated,
        deletedEntry,
      )
      return { error: ApiErrorCodes.branch_delete_failed, status: 500 }
    }
  } catch {
    await restoreBranchRegistryAfterDeleteFailure(
      id,
      parent,
      parentIdxBefore,
      forkLocated,
      deletedEntry,
    )
    return { error: ApiErrorCodes.branch_delete_failed, status: 500 }
  }

  const branchDir = path.join(conversationDir(id), ...target.split('/'))
  try {
    await rm(branchDir, { recursive: true, force: true })
  } catch {
    await restoreBranchRegistryAfterDeleteFailure(
      id,
      parent,
      parentIdxBefore,
      forkLocated,
      deletedEntry,
    )
    return { error: ApiErrorCodes.branch_delete_failed, status: 500 }
  }

  try {
    await deleteTurnMemoryByBranchSubtree(id, target)
  } catch {
    // 磁盘已删；memory 残留可后续 reindex
  }
  invalidateChunkIndexSyncCache(id)

  let activeBranchPath = await readConversationActiveBranchPath(id)
  if (activePathWithinDeletedSubtree(activeBranchPath, target)) {
    const reset = await updateConversationActiveBranchPath(id, parent || null)
    if ('error' in reset) {
      return reset
    }
    activeBranchPath = await readConversationActiveBranchPath(id)
  }

  return { path: target, activeBranchPath }
}

/**
 * 将父 index.branches[].label 同步到 fork chunk 注册表（repair 用；以 index 为准）。
 */
export async function repairBranchRegistryLabelDrift(
  conversationId: string,
): Promise<{ repaired: number }> {
  const paths = await collectRegisteredBranchPaths(conversationId)
  let repaired = 0
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
  }
  return { repaired }
}
