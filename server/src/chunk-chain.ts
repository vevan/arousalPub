import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  conversationDir,
  readBranchConversationIndex,
  readConversationIndex,
  writeBranchConversationIndex,
  writeChunkFile,
  writeConversationIndex,
  type ChunkFile,
  type ConversationIndex,
  type TurnRecord,
} from './chat-storage.js'
import {
  CHUNK_SETTINGS_DEFAULTS,
  normalizeChunkSettings,
  type ChunkSettings,
} from './chunk-settings.js'
import { readGlobalChunkSettings } from './user-preferences-file.js'
import {
  chunkStorageRelativePath,
  normalizeBranchPath,
  normalizeChunkBasename,
  branchAncestorPaths,
  resolveNestedBranchPath,
  splitChunkStoragePath,
} from './chunk-path.js'

const TURN_CHUNK_FILE_RE = /^turn-(\d{6})-(\d{6})\.json$/

export function chunkFileNameForRange(start: number, end: number): string {
  const pad = (n: number) => String(n).padStart(6, '0')
  return `turn-${pad(start)}-${pad(end)}.json`
}

export function chunkIdFromFileName(fileName: string): string {
  return fileName.replace(/\.json$/i, '')
}

/** 新建块时的 ordinal 闭区间 [start, end]（含端点，与文件名一致） */
export function ordinalRangeForNewChunk(
  startOrdinal: number,
  turnsPerFile: number,
): { start: number; end: number } {
  const start = Math.max(0, Math.floor(startOrdinal))
  const cap = normalizeChunkSettings({ turnsPerFile }).turnsPerFile
  return { start, end: start + cap - 1 }
}

/** 含 turnOrdinal 的标准 chunk 窗口起始（与文件名 turn-000100-000199 对齐） */
export function chunkAlignedRangeStart(
  ordinal: number,
  turnsPerFile: number,
): number {
  const ord = Math.max(0, Math.floor(ordinal))
  const cap = normalizeChunkSettings({ turnsPerFile }).turnsPerFile
  return Math.floor(ord / cap) * cap
}

export function inferTurnsPerFileFromFileName(fileName: string): number | null {
  const base = path.basename(fileName)
  const m = TURN_CHUNK_FILE_RE.exec(base)
  if (!m) return null
  const start = Number.parseInt(m[1]!, 10)
  const end = Number.parseInt(m[2]!, 10)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return null
  }
  return end - start + 1
}

/** 块容量：优先 meta.turnsPerFile，否则从文件名推断，最后默认 100 */
export function resolveChunkTurnsPerFile(
  chunk: ChunkFile,
  fileName: string,
): number {
  if (
    typeof chunk.meta.turnsPerFile === 'number' &&
    Number.isFinite(chunk.meta.turnsPerFile)
  ) {
    return normalizeChunkSettings({
      turnsPerFile: chunk.meta.turnsPerFile,
    }).turnsPerFile
  }
  return (
    inferTurnsPerFileFromFileName(fileName) ??
    CHUNK_SETTINGS_DEFAULTS.turnsPerFile
  )
}

export function isChunkFull(
  chunk: ChunkFile,
  fileName: string,
): boolean {
  return chunk.turns.length >= resolveChunkTurnsPerFile(chunk, fileName)
}

export async function readChunkFile(
  conversationId: string,
  fileName: string,
): Promise<ChunkFile | null> {
  try {
    const raw = await readFile(
      path.join(conversationDir(conversationId), fileName),
      'utf8',
    )
    return JSON.parse(raw) as ChunkFile
  } catch {
    return null
  }
}

/** 按 branchPath + basename 读取 chunk（memory v2 召回用） */
export async function readChunkFileAt(
  conversationId: string,
  branchPath: string,
  chunkFileName: string,
): Promise<ChunkFile | null> {
  const rel = chunkStorageRelativePath(branchPath, chunkFileName)
  return readChunkFile(conversationId, rel)
}

function sortTurnsUnique(turns: TurnRecord[]): TurnRecord[] {
  const sorted = turns.slice().sort((a, b) => a.turnOrdinal - b.turnOrdinal)
  const seen = new Set<string>()
  const out: TurnRecord[] = []
  for (const t of sorted) {
    if (seen.has(t.turnId)) continue
    seen.add(t.turnId)
    out.push(t)
  }
  return out
}

/** 从 branches[] 单条解析相对子目录 path */
export function parseBranchRegistryPath(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = (entry as { path?: unknown }).path
  if (typeof raw !== 'string' || !raw.trim()) return null
  try {
    return normalizeBranchPath(raw.trim())
  } catch {
    return null
  }
}

/** 从 branches[] 单条解析 forkTurnId */
export function parseBranchRegistryForkTurnId(entry: unknown): string | null {
  if (!entry || typeof entry !== 'object') return null
  const raw = (entry as { forkTurnId?: unknown }).forkTurnId
  if (typeof raw !== 'string' || !raw.trim()) return null
  return raw.trim()
}

/** 在 parent 分支 index.branches[] 中查找相对 segment 的注册项 */
export async function findBranchRegistryEntry(
  conversationId: string,
  parentBranchPath: string,
  relativeSegment: string,
): Promise<unknown | null> {
  const parent = normalizeBranchPath(parentBranchPath)
  const seg = relativeSegment.trim()
  if (!seg) return null
  const idx = parent
    ? await readBranchConversationIndex(conversationId, parent)
    : await readConversationIndex(conversationId)
  if (!Array.isArray(idx?.branches)) return null
  for (const entry of idx.branches) {
    const p = parseBranchRegistryPath(entry)
    if (!p) continue
    if (p === seg || p.split('/').pop() === seg) return entry
  }
  return null
}

/** 读取会话 activeBranchPath（非法值视为 ""） */
export async function readConversationActiveBranchPath(
  conversationId: string,
): Promise<string> {
  const idx = await readConversationIndex(conversationId)
  if (idx?.activeBranchPath === null || idx?.activeBranchPath === undefined) {
    return ''
  }
  if (typeof idx.activeBranchPath !== 'string' || !idx.activeBranchPath.trim()) {
    return ''
  }
  try {
    return normalizeBranchPath(idx.activeBranchPath)
  } catch {
    return ''
  }
}

/** 仅读指定 branchPath 子目录 chunk 链上的 turn（不含共享前缀） */
export async function readAllTurnsAtBranchPath(
  conversationId: string,
  branchPath: string,
): Promise<TurnRecord[]> {
  const bp = normalizeBranchPath(branchPath)
  const files = await listChunkFileNamesAt(conversationId, bp)
  const collected: TurnRecord[] = []
  for (const fileName of files) {
    const chunk = await readChunkFileAt(conversationId, bp, fileName)
    if (chunk?.turns?.length) collected.push(...chunk.turns)
  }
  return sortTurnsUnique(collected)
}

/** 合并 active 路径的一段前缀（parent 上 fork 及之前） */
export function mergeActivePathPrefixSegment(params: {
  accumulated: TurnRecord[]
  parentBranchTurns: TurnRecord[]
  forkTurnId: string
}): { merged: TurnRecord[]; forkOrdinal: number } | null {
  const forkTurn = params.parentBranchTurns.find(
    (t) => t.turnId === params.forkTurnId,
  )
  if (!forkTurn) return null
  const seen = new Set(params.accumulated.map((t) => t.turnId))
  const merged = params.accumulated.slice()
  for (const t of params.parentBranchTurns) {
    if (t.turnOrdinal <= forkTurn.turnOrdinal && !seen.has(t.turnId)) {
      merged.push(t)
      seen.add(t.turnId)
    }
  }
  return {
    merged: sortTurnsUnique(merged),
    forkOrdinal: forkTurn.turnOrdinal,
  }
}

/** 分支注册表与 active 路径不一致（禁止静默返回空历史） */
export class BranchRegistryBrokenError extends Error {
  readonly code = 'branch_registry_broken'

  constructor(
    readonly conversationId: string,
    readonly activeBranchPath: string,
    readonly segment?: string,
  ) {
    super('branch_registry_broken')
    this.name = 'BranchRegistryBrokenError'
  }
}

export function isBranchRegistryBrokenError(
  e: unknown,
): e is BranchRegistryBrokenError {
  return e instanceof BranchRegistryBrokenError
}

/**
 * active 路径线性 turn：祖先前缀（至各 forkTurnId 含 fork 轮）+ active 子树 suffix。
 * 主路径 activeBranchPath="" 时等价 readAllTurnsAtBranchPath("").
 */
export async function resolveActivePathTurns(
  conversationId: string,
  activeBranchPath: string | null | undefined,
  range?: { from: number; to: number },
): Promise<TurnRecord[]> {
  const active = normalizeBranchPath(activeBranchPath ?? '')

  let merged: TurnRecord[]
  if (!active) {
    merged = await readAllTurnsAtBranchPath(conversationId, '')
  } else {
    const segments = active.split('/')
    merged = []
    let parentPath = ''
    let lastForkOrdinal = -1

    for (let i = 0; i < segments.length; i++) {
      const segment = segments[i]!
      const entry = await findBranchRegistryEntry(
        conversationId,
        parentPath,
        segment,
      )
      const forkTurnId = entry ? parseBranchRegistryForkTurnId(entry) : null
      if (!forkTurnId) {
        throw new BranchRegistryBrokenError(conversationId, active, segment)
      }

      const parentTurns =
        parentPath === ''
          ? await readAllTurnsAtBranchPath(conversationId, '')
          : await resolveActivePathTurns(conversationId, parentPath)

      const step = mergeActivePathPrefixSegment({
        accumulated: merged,
        parentBranchTurns: parentTurns,
        forkTurnId,
      })
      if (!step) {
        throw new BranchRegistryBrokenError(conversationId, active, segment)
      }
      merged = step.merged
      lastForkOrdinal = step.forkOrdinal
      parentPath = segments.slice(0, i + 1).join('/')
    }

    if (lastForkOrdinal < 0) {
      throw new BranchRegistryBrokenError(conversationId, active)
    }

    const suffix = await readAllTurnsAtBranchPath(conversationId, active)
    const seen = new Set(merged.map((t) => t.turnId))
    for (const t of suffix) {
      if (t.turnOrdinal > lastForkOrdinal && !seen.has(t.turnId)) {
        merged.push(t)
        seen.add(t.turnId)
      }
    }
    merged = sortTurnsUnique(merged)
  }

  if (range) {
    const { from, to } = range
    merged = merged.filter(
      (t) => t.turnOrdinal >= from && t.turnOrdinal <= to,
    )
  }
  return merged
}

/** fork 轮在父路径上的 turnOrdinal（空分支首条 turn = 返回值 + 1） */
export async function resolveBranchForkOrdinal(
  conversationId: string,
  fullBranchPath: string,
): Promise<number | null> {
  const target = normalizeBranchPath(fullBranchPath)
  if (!target) return null
  const segments = target.split('/').filter(Boolean)
  let parentPath = ''
  for (const segment of segments) {
    const fullSoFar = parentPath ? `${parentPath}/${segment}` : segment
    const entry = await findBranchRegistryEntry(
      conversationId,
      parentPath,
      segment,
    )
    if (fullSoFar === target) {
      const forkTurnId = entry ? parseBranchRegistryForkTurnId(entry) : null
      if (!forkTurnId) return null
      const parentVisible =
        parentPath === ''
          ? await readAllTurnsAtBranchPath(conversationId, '')
          : await resolveActivePathTurns(conversationId, parentPath)
      const fork = parentVisible.find((t) => t.turnId === forkTurnId)
      return fork?.turnOrdinal ?? null
    }
    parentPath = fullSoFar
  }
  return null
}

/** 下一 append 的 turnOrdinal（空分支 = forkOrdinal + 1） */
export async function resolveNextTurnOrdinalForBranchAppend(
  conversationId: string,
  branchPath: string,
): Promise<number | null> {
  const bp = normalizeBranchPath(branchPath)
  if (!bp) {
    const onMain = await readAllTurnsAtBranchPath(conversationId, '')
    if (onMain.length === 0) return 0
    return Math.max(...onMain.map((t) => t.turnOrdinal)) + 1
  }
  const branchIdx = await readBranchConversationIndex(conversationId, bp)
  if (branchIdx?.tailChunkFile) {
    const tailFile = normalizeTailChunkBasename(branchIdx.tailChunkFile, bp)
    const tail = await readChunkFileAt(conversationId, bp, tailFile)
    if (tail?.turns.length) {
      return Math.max(...tail.turns.map((t) => t.turnOrdinal)) + 1
    }
  }
  const forkOrdinal = await resolveBranchForkOrdinal(conversationId, bp)
  if (forkOrdinal === null) return null
  return forkOrdinal + 1
}

/** 读指定 branchPath 的 tail chunk（basename 存于对应 index） */
export async function readTailChunkAt(
  conversationId: string,
  branchPath?: string | null,
): Promise<ChunkFile | null> {
  const bp =
    branchPath !== undefined
      ? normalizeBranchPath(branchPath ?? '')
      : await readConversationActiveBranchPath(conversationId)
  const idx = bp
    ? await readBranchConversationIndex(conversationId, bp)
    : await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return null
  const tailFile = normalizeTailChunkBasename(idx.tailChunkFile, bp)
  return readChunkFileAt(conversationId, bp, tailFile)
}

async function effectiveActiveBranchPath(
  conversationId: string,
  override?: string | null,
): Promise<string> {
  if (override !== undefined) {
    return normalizeBranchPath(override ?? '')
  }
  return readConversationActiveBranchPath(conversationId)
}

/** 从 index branches[] 递归收集已注册分支（会话根相对路径） */
export async function collectRegisteredBranchPaths(
  conversationId: string,
): Promise<string[]> {
  const out = new Set<string>()

  async function walk(
    parentBranchPath: string,
    branches: unknown[] | undefined,
  ): Promise<void> {
    if (!Array.isArray(branches)) return
    for (const entry of branches) {
      const rel = parseBranchRegistryPath(entry)
      if (!rel) continue
      const full = resolveNestedBranchPath(parentBranchPath, rel)
      if (!full || out.has(full)) continue
      out.add(full)
      const branchIdx = await readBranchConversationIndex(conversationId, full)
      await walk(full, branchIdx?.branches)
    }
  }

  const root = await readConversationIndex(conversationId)
  await walk('', root?.branches)
  return [...out]
}

export interface ChunkChainLocation {
  branchPath: string
  chunkFileName: string
}

export function normalizeTailChunkBasename(
  tailChunkFile: string,
  branchPath: string,
): string {
  const bp = normalizeBranchPath(branchPath)
  if (!bp) {
    return normalizeChunkBasename(tailChunkFile)
  }
  const split = splitChunkStoragePath(tailChunkFile)
  return split.chunkFileName
}

/** 沿指定 branchPath 的 tail → previous 列出 chunk basename（旧 → 新） */
export async function listChunkFileNamesAt(
  conversationId: string,
  branchPath: string,
): Promise<string[]> {
  const bp = normalizeBranchPath(branchPath)
  const idx = bp
    ? await readBranchConversationIndex(conversationId, bp)
    : await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return []

  let fileName: string | null = normalizeTailChunkBasename(idx.tailChunkFile, bp)
  const reversed: string[] = []
  const guard = new Set<string>()
  while (fileName) {
    if (guard.has(fileName)) break
    guard.add(fileName)
    reversed.push(fileName)
    const chunk = await readChunkFileAt(conversationId, bp, fileName)
    const prev = chunk?.meta.links.previous
    fileName = prev ? normalizeTailChunkBasename(prev, bp) : null
  }
  return reversed.reverse()
}

/** 从 tail 沿 previous 列出主路径 chunk 文件名（旧 → 新） */
export async function listChunkFileNames(
  conversationId: string,
): Promise<string[]> {
  return listChunkFileNamesAt(conversationId, '')
}

/** 主路径 + 已注册分支子树的全部 (branchPath, chunkFileName) */
export async function enumerateAllChunkChains(
  conversationId: string,
): Promise<ChunkChainLocation[]> {
  const out: ChunkChainLocation[] = []
  const mainFiles = await listChunkFileNamesAt(conversationId, '')
  for (const chunkFileName of mainFiles) {
    out.push({ branchPath: '', chunkFileName })
  }
  const branchPaths = await collectRegisteredBranchPaths(conversationId)
  for (const branchPath of branchPaths) {
    const files = await listChunkFileNamesAt(conversationId, branchPath)
    for (const chunkFileName of files) {
      out.push({ branchPath, chunkFileName })
    }
  }
  return out
}

/**
 * 沿 chunk 链按 turnId 定位块文件（仅主路径 chunk 链）。
 * @deprecated 分支场景请使用分支路径下的 chunk 读取；保留供遗留调用。
 */
export async function readChunkContainingTurnId(
  conversationId: string,
  turnId: string,
): Promise<{ chunk: ChunkFile; fileName: string } | null> {
  const id = turnId.trim()
  if (!id) return null
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return null
  let fileName: string | null = idx.tailChunkFile
  const guard = new Set<string>()
  while (fileName) {
    if (guard.has(fileName)) break
    guard.add(fileName)
    const chunk = await readChunkFile(conversationId, fileName)
    if (chunk?.turns.some((t) => t.turnId === id)) {
      return { chunk, fileName }
    }
    fileName = chunk?.meta.links.previous ?? null
  }
  return null
}

export function isTailChunkFile(
  idx: ConversationIndex,
  chunkFileName: string,
): boolean {
  return idx.tailChunkFile === chunkFileName
}

function chunkOrdinalRangeOverlaps(
  chunk: ChunkFile,
  from: number,
  to: number,
): boolean {
  const start = chunk.meta.ordinalRange?.start ?? 0
  const end = chunk.meta.ordinalRange?.end ?? start
  return end >= from && start <= to
}

/** 尾部 N 轮的 ordinal 闭区间（纯函数，单测用） */
export function computeTailOrdinalReadRange(
  maxOrdinal: number,
  limit: number,
): { from: number; to: number; hasMoreBefore: boolean } {
  const cap = Math.max(1, Math.floor(limit))
  const to = Math.max(0, Math.floor(maxOrdinal))
  const from = Math.max(0, to - cap + 1)
  return { from, to, hasMoreBefore: from > 0 }
}

/** before 之前（不含 before）最多 limit 轮的 ordinal 闭区间（纯函数，单测用） */
export function computeBeforeOrdinalReadRange(
  beforeExclusive: number,
  limit: number,
): { from: number; to: number; hasMoreBefore: boolean } {
  const cap = Math.max(1, Math.floor(limit))
  const before = Math.max(0, Math.floor(beforeExclusive))
  if (before <= 0) {
    return { from: 0, to: -1, hasMoreBefore: false }
  }
  const to = before - 1
  const from = Math.max(0, to - cap + 1)
  return { from, to, hasMoreBefore: from > 0 }
}

export interface ReadTurnsBeforeResult {
  turns: TurnRecord[]
  hasMoreBefore: boolean
  minOrdinal: number | null
  maxOrdinal: number | null
}

/** 读取 turnOrdinal < beforeExclusive 的最多 limit 轮（紧邻 before 之前） */
export async function readTurnsBefore(
  conversationId: string,
  beforeExclusive: number,
  limit: number,
  activeBranchPath?: string | null,
): Promise<ReadTurnsBeforeResult> {
  const { from, to, hasMoreBefore } = computeBeforeOrdinalReadRange(
    beforeExclusive,
    limit,
  )
  if (to < from) {
    return {
      turns: [],
      hasMoreBefore: false,
      minOrdinal: null,
      maxOrdinal: null,
    }
  }
  const active = await effectiveActiveBranchPath(conversationId, activeBranchPath)
  const turns = await resolveActivePathTurns(conversationId, active, {
    from,
    to,
  })
  const pathHasMoreBefore =
    turns.length > 0
      ? Math.min(...turns.map((t) => t.turnOrdinal)) > 0
      : beforeExclusive > 0
  const minOrdinal =
    turns.length > 0 ? Math.min(...turns.map((t) => t.turnOrdinal)) : null
  const maxOrdinal =
    turns.length > 0 ? Math.max(...turns.map((t) => t.turnOrdinal)) : null
  return {
    turns,
    hasMoreBefore: hasMoreBefore && pathHasMoreBefore,
    minOrdinal,
    maxOrdinal,
  }
}

export interface ReadTurnsTailResult {
  turns: TurnRecord[]
  hasMoreBefore: boolean
  minOrdinal: number | null
  maxOrdinal: number | null
}

/** 读取对话尾部最多 limit 轮（active 路径合并读） */
export async function readTurnsTail(
  conversationId: string,
  limit: number,
  activeBranchPath?: string | null,
): Promise<ReadTurnsTailResult> {
  const active = await effectiveActiveBranchPath(conversationId, activeBranchPath)
  const onPath = await resolveActivePathTurns(conversationId, active)
  if (onPath.length === 0) {
    return {
      turns: [],
      hasMoreBefore: false,
      minOrdinal: null,
      maxOrdinal: null,
    }
  }
  const maxOrdinal = Math.max(...onPath.map((t) => t.turnOrdinal))
  const { from, to, hasMoreBefore } = computeTailOrdinalReadRange(
    maxOrdinal,
    limit,
  )
  const turns = onPath.filter(
    (t) => t.turnOrdinal >= from && t.turnOrdinal <= to,
  )
  const minOrdinal =
    turns.length > 0 ? Math.min(...turns.map((t) => t.turnOrdinal)) : null
  return {
    turns,
    hasMoreBefore,
    minOrdinal,
    maxOrdinal: turns.length > 0 ? maxOrdinal : null,
  }
}

/**
 * 加载与 [from,to] 可能相交的 chunk（每文件至多读一次；仅主路径）。
 * @deprecated 分支场景请使用 `resolveActivePathTurns`；保留供遗留调用。
 */
export async function loadConversationChunksForOrdinalRange(
  conversationId: string,
  from: number,
  to: number,
): Promise<Map<string, ChunkFile>> {
  const idx = await readConversationIndex(conversationId)
  const map = new Map<string, ChunkFile>()
  if (!idx?.tailChunkFile) return map
  let fileName: string | null = idx.tailChunkFile
  const guard = new Set<string>()
  while (fileName) {
    if (guard.has(fileName)) break
    guard.add(fileName)
    const chunk = await readChunkFile(conversationId, fileName)
    if (!chunk) break
    if (chunkOrdinalRangeOverlaps(chunk, from, to)) {
      map.set(fileName, chunk)
    }
    fileName = chunk.meta.links.previous ?? null
  }
  return map
}

/** 仅读取 ordinal 闭区间 [from, to] 内的 turn（active 路径合并读） */
export async function readTurnsInOrdinalRange(
  conversationId: string,
  from: number,
  to: number,
  activeBranchPath?: string | null,
): Promise<TurnRecord[]> {
  if (from > to || from < 0) return []
  const active = await effectiveActiveBranchPath(conversationId, activeBranchPath)
  return resolveActivePathTurns(conversationId, active, { from, to })
}

/** 从 tail 沿 previous 读取全链 turn（运维/兼容；热路径请用 readTurnsTail / readTurnsInOrdinalRange） */
export async function readAllTurns(
  conversationId: string,
): Promise<TurnRecord[]> {
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return []
  const collected: TurnRecord[] = []
  let fileName: string | null = idx.tailChunkFile
  const guard = new Set<string>()
  while (fileName) {
    if (guard.has(fileName)) break
    guard.add(fileName)
    const chunk = await readChunkFile(conversationId, fileName)
    if (!chunk?.turns?.length) {
      fileName = chunk?.meta.links.previous ?? null
      continue
    }
    collected.push(...chunk.turns)
    fileName = chunk.meta.links.previous
  }
  return sortTurnsUnique(collected)
}

export function buildFirstChunkDescriptor(turnsPerFile: number): {
  fileName: string
  meta: ChunkFile['meta']
} {
  const cap = normalizeChunkSettings({ turnsPerFile }).turnsPerFile
  const range = ordinalRangeForNewChunk(0, cap)
  const fileName = chunkFileNameForRange(range.start, range.end)
  return {
    fileName,
    meta: {
      chunkId: chunkIdFromFileName(fileName),
      ordinalRange: { start: 0, end: 0 },
      turnsPerFile: cap,
      links: { previous: null, next: null, branches: [] },
    },
  }
}

function nextTurnOrdinal(chunk: ChunkFile): number {
  if (chunk.turns.length === 0) return 0
  return Math.max(...chunk.turns.map((t) => t.turnOrdinal)) + 1
}

function emptyChunkMeta(params: {
  rangeStart: number
  turnsPerFile: number
  previous: string | null
}): ChunkFile['meta'] {
  const range = ordinalRangeForNewChunk(params.rangeStart, params.turnsPerFile)
  const fileName = chunkFileNameForRange(range.start, range.end)
  return {
    chunkId: chunkIdFromFileName(fileName),
    ordinalRange: { start: range.start, end: range.start },
    turnsPerFile: range.end - range.start + 1,
    links: { previous: params.previous, next: null, branches: [] },
  }
}

/** 尾块已满时滚动到新块；新块使用当前全局 turnsPerFile */
async function rotateTailChunk(
  conversationId: string,
  idx: ConversationIndex,
  branchPath: string,
  oldTail: ChunkFile,
  oldFileName: string,
  newTurnsPerFile: number,
): Promise<{
  idx: ConversationIndex
  tailFile: string
  tail: ChunkFile
  sealedChunkFile: string
}> {
  const bp = normalizeBranchPath(branchPath)
  const nextOrd = nextTurnOrdinal(oldTail)
  const cap = normalizeChunkSettings({ turnsPerFile: newTurnsPerFile }).turnsPerFile
  const meta = emptyChunkMeta({
    rangeStart: nextOrd,
    turnsPerFile: cap,
    previous: oldFileName,
  })
  const newFileName = chunkFileNameForRange(
    meta.ordinalRange.start,
    meta.ordinalRange.start + cap - 1,
  )
  meta.chunkId = chunkIdFromFileName(newFileName)

  oldTail.meta.links.next = newFileName
  await writeChunkFile(
    conversationId,
    chunkStorageRelativePath(bp, oldFileName),
    oldTail,
  )

  const newTail: ChunkFile = {
    schemaVersion: 1,
    meta,
    turns: [],
  }
  await writeChunkFile(
    conversationId,
    chunkStorageRelativePath(bp, newFileName),
    newTail,
  )

  idx.tailChunkFile = newFileName
  invalidateChunkIndexSyncCache(conversationId)
  if (bp) {
    await writeBranchConversationIndex(conversationId, bp, idx)
  } else {
    await writeConversationIndex(conversationId, idx)
  }
  return {
    idx,
    tailFile: newFileName,
    tail: newTail,
    sealedChunkFile: oldFileName,
  }
}

/**
 * 超大单块拆链：按**该块自身**容量切分；中间块沿用原容量，仅末尾新 tail 在后续滚动时用新全局设置。
 */
export async function splitOversizedTailChunkIfNeeded(
  conversationId: string,
  branchPath = '',
): Promise<string[]> {
  const bp = normalizeBranchPath(branchPath)
  const sealed: string[] = []
  const idx = bp
    ? await readBranchConversationIndex(conversationId, bp)
    : await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return sealed
  const tailName = normalizeTailChunkBasename(idx.tailChunkFile, bp)
  const tail = await readChunkFileAt(conversationId, bp, tailName)
  if (!tail?.turns.length) return sealed
  if (tail.meta.links.next) return sealed

  const cap = resolveChunkTurnsPerFile(tail, tailName)
  if (tail.turns.length <= cap) return sealed

  const sorted = tail.turns
    .slice()
    .sort((a, b) => a.turnOrdinal - b.turnOrdinal)
  const firstGroup = sorted.slice(0, cap)
  const rest = sorted.slice(cap)
  if (rest.length === 0) return sealed

  tail.turns = firstGroup
  tail.meta.ordinalRange = {
    start: firstGroup[0]!.turnOrdinal,
    end: firstGroup[firstGroup.length - 1]!.turnOrdinal,
  }

  let prevFile = tailName
  let prevChunk = tail
  let remaining = rest

  while (remaining.length > 0) {
    const group = remaining.slice(0, cap)
    remaining = remaining.slice(cap)
    const startOrd = group[0]!.turnOrdinal
    const meta = emptyChunkMeta({
      rangeStart: startOrd,
      turnsPerFile: cap,
      previous: prevFile,
    })
    const newFileName = chunkFileNameForRange(
      meta.ordinalRange.start,
      meta.ordinalRange.start + cap - 1,
    )
    meta.chunkId = chunkIdFromFileName(newFileName)
    meta.ordinalRange = {
      start: startOrd,
      end: group[group.length - 1]!.turnOrdinal,
    }

    prevChunk.meta.links.next = newFileName
    await writeChunkFile(
      conversationId,
      chunkStorageRelativePath(bp, prevFile),
      prevChunk,
    )
    sealed.push(prevFile)

    const newChunk: ChunkFile = {
      schemaVersion: 1,
      meta,
      turns: group,
    }
    await writeChunkFile(
      conversationId,
      chunkStorageRelativePath(bp, newFileName),
      newChunk,
    )

    prevFile = newFileName
    prevChunk = newChunk
  }

  idx.tailChunkFile = prevFile
  if (!idx.headChunkFile) idx.headChunkFile = tailName
  invalidateChunkIndexSyncCache(conversationId)
  if (bp) {
    await writeBranchConversationIndex(conversationId, bp, idx)
  } else {
    await writeConversationIndex(conversationId, idx)
  }
  return sealed
}

/**
 * append 前：迁移超大尾块、必要时滚动 tail。
 * 返回当前可写入的 tail 块与文件名（basename；写入时用 chunkStorageRelativePath）。
 */
export async function prepareTailChunkForAppend(
  conversationId: string,
  branchPath = '',
): Promise<{
  idx: ConversationIndex
  branchPath: string
  tailFile: string
  tail: ChunkFile
  isNewBranchChunk: boolean
  sealedChunkFiles: string[]
} | null> {
  const bp = normalizeBranchPath(branchPath)
  const sealedChunkFiles: string[] = []
  sealedChunkFiles.push(
    ...(await splitOversizedTailChunkIfNeeded(conversationId, bp)),
  )

  let idx = bp
    ? await readBranchConversationIndex(conversationId, bp)
    : await readConversationIndex(conversationId)
  if (!idx) return null

  if (!idx.tailChunkFile) {
    if (!bp) return null
    const nextStart = await resolveNextTurnOrdinalForBranchAppend(
      conversationId,
      bp,
    )
    if (nextStart === null) return null
    const global = await readGlobalChunkSettings()
    const cap = global.turnsPerFile
    const alignedStart = chunkAlignedRangeStart(nextStart, cap)
    const window = ordinalRangeForNewChunk(alignedStart, cap)
    const tailFile = chunkFileNameForRange(window.start, window.end)
    const meta: ChunkFile['meta'] = {
      chunkId: chunkIdFromFileName(tailFile),
      ordinalRange: { start: nextStart, end: nextStart },
      turnsPerFile: cap,
      links: { previous: null, next: null, branches: [] },
    }
    const tail: ChunkFile = {
      schemaVersion: 1,
      meta,
      turns: [],
    }
    return {
      idx,
      branchPath: bp,
      tailFile,
      tail,
      isNewBranchChunk: true,
      sealedChunkFiles,
    }
  }

  const tailFile = normalizeTailChunkBasename(idx.tailChunkFile, bp)
  const tail = await readChunkFileAt(conversationId, bp, tailFile)
  if (!tail) return null

  if (!isChunkFull(tail, tailFile)) {
    return {
      idx,
      branchPath: bp,
      tailFile,
      tail,
      isNewBranchChunk: false,
      sealedChunkFiles,
    }
  }

  const global = await readGlobalChunkSettings()
  const rotated = await rotateTailChunk(
    conversationId,
    idx,
    bp,
    tail,
    tailFile,
    global.turnsPerFile,
  )
  return {
    idx: rotated.idx,
    branchPath: bp,
    tailFile: rotated.tailFile,
    tail: rotated.tail,
    isNewBranchChunk: false,
    sealedChunkFiles: [...sealedChunkFiles, rotated.sealedChunkFile],
  }
}

export async function readChunkContainingOrdinal(
  conversationId: string,
  turnOrdinal: number,
  activeBranchPath?: string | null,
): Promise<{ chunk: ChunkFile; fileName: string; branchPath: string } | null> {
  const active = await effectiveActiveBranchPath(
    conversationId,
    activeBranchPath,
  )
  const hits = await resolveActivePathTurns(conversationId, active, {
    from: turnOrdinal,
    to: turnOrdinal,
  })
  const turn = hits[0]
  if (!turn) return null

  const searchPaths = active
    ? [...branchAncestorPaths(active)]
    : ['']

  for (const bp of searchPaths) {
    const files = await listChunkFileNamesAt(conversationId, bp)
    for (const fileName of files) {
      const chunk = await readChunkFileAt(conversationId, bp, fileName)
      if (chunk?.turns.some((t) => t.turnId === turn.turnId)) {
        return { chunk, fileName, branchPath: bp }
      }
    }
  }
  return null
}

/** turn 是否存在于非 active 路径（用于 batch PATCH 明确错误） */
export async function isTurnOrdinalOffActivePath(
  conversationId: string,
  turnOrdinal: number,
  activeBranchPath?: string | null,
): Promise<boolean> {
  const active = await effectiveActiveBranchPath(
    conversationId,
    activeBranchPath,
  )
  const onActive = await readChunkContainingOrdinal(
    conversationId,
    turnOrdinal,
    active,
  )
  if (onActive) return false

  const paths = ['', ...(await collectRegisteredBranchPaths(conversationId))]
  for (const bp of paths) {
    if (bp === active) continue
    const files = await listChunkFileNamesAt(conversationId, bp)
    for (const fileName of files) {
      const chunk = await readChunkFileAt(conversationId, bp, fileName)
      if (chunk?.turns.some((t) => t.turnOrdinal === turnOrdinal)) {
        return true
      }
    }
  }
  return false
}

export type ChunkIndexRepairResult = {
  headChunkFile: string | null
  tailChunkFile: string | null
  repaired: boolean
  brokenChain: boolean
  chunkFileCount: number
}

/** 纯函数：由 links 图计算 head/tail（单测用） */
export function computeHeadTailFromLinks(
  graph: ReadonlyMap<string, { previous: string | null; next: string | null }>,
): { head: string | null; tail: string | null; broken: boolean } {
  const files = [...graph.keys()]
  if (files.length === 0) return { head: null, tail: null, broken: false }
  if (files.length === 1) {
    return { head: files[0]!, tail: files[0]!, broken: false }
  }

  const incoming = new Map<string, number>()
  for (const f of files) incoming.set(f, 0)
  for (const [, links] of graph) {
    if (links.next && incoming.has(links.next)) {
      incoming.set(links.next, (incoming.get(links.next) ?? 0) + 1)
    }
  }
  const heads = files.filter((f) => (incoming.get(f) ?? 0) === 0)
  const tails = files.filter((f) => {
    const next = graph.get(f)?.next
    return !next || !graph.has(next)
  })

  if (heads.length !== 1 || tails.length !== 1) {
    return { head: heads[0] ?? null, tail: tails[0] ?? null, broken: true }
  }

  const head = heads[0]!
  const tail = tails[0]!
  let cur: string | null = head
  const visited = new Set<string>()
  while (cur) {
    if (visited.has(cur)) return { head, tail, broken: true }
    visited.add(cur)
    const nextFile: string | null = graph.get(cur)?.next ?? null
    if (nextFile && !graph.has(nextFile)) break
    cur = nextFile
  }
  if (visited.size !== files.length) {
    return { head, tail, broken: true }
  }
  return { head, tail, broken: false }
}

async function loadChunkLinkGraphAt(
  conversationId: string,
  branchPath: string,
): Promise<Map<string, { previous: string | null; next: string | null }>> {
  const bp = normalizeBranchPath(branchPath)
  const dir = bp
    ? path.join(conversationDir(conversationId), bp)
    : conversationDir(conversationId)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return new Map()
  }
  const graph = new Map<string, { previous: string | null; next: string | null }>()
  for (const name of entries) {
    if (!TURN_CHUNK_FILE_RE.test(name)) continue
    const chunk = await readChunkFileAt(conversationId, bp, name)
    if (!chunk) continue
    graph.set(name, {
      previous: chunk.meta.links.previous ?? null,
      next: chunk.meta.links.next ?? null,
    })
  }
  return graph
}

/** 扫描指定 branchPath 下 `turn-*.json` 的 meta.links，计算 head/tail（不写盘） */
export async function rebuildHeadTailFromLinks(
  conversationId: string,
  branchPath = '',
): Promise<ChunkIndexRepairResult> {
  const graph = await loadChunkLinkGraphAt(conversationId, branchPath)
  const { head, tail, broken } = computeHeadTailFromLinks(graph)
  return {
    headChunkFile: head,
    tailChunkFile: tail,
    repaired: false,
    brokenChain: broken,
    chunkFileCount: graph.size,
  }
}

async function writeChunkIndexHeadTail(
  conversationId: string,
  branchPath: string,
  idx: ConversationIndex,
  headChunkFile: string | null,
  tailChunkFile: string | null,
): Promise<void> {
  const bp = normalizeBranchPath(branchPath)
  idx.headChunkFile = headChunkFile
  idx.tailChunkFile = tailChunkFile
  idx.updatedAt = new Date().toISOString()
  if (bp) {
    await writeBranchConversationIndex(conversationId, bp, idx)
  } else {
    await writeConversationIndex(conversationId, idx)
  }
}

async function syncChunkIndexScopeIfDrifted(
  conversationId: string,
  branchPath: string,
): Promise<boolean> {
  const bp = normalizeBranchPath(branchPath)
  const idx = bp
    ? await readBranchConversationIndex(conversationId, bp)
    : await readConversationIndex(conversationId)
  if (!idx) return false

  const computed = await rebuildHeadTailFromLinks(conversationId, bp)
  if (computed.brokenChain) return false

  if (computed.chunkFileCount === 0) {
    if (idx.headChunkFile !== null || idx.tailChunkFile !== null) {
      await writeChunkIndexHeadTail(conversationId, bp, idx, null, null)
      return true
    }
    return false
  }

  if (
    idx.headChunkFile === computed.headChunkFile &&
    idx.tailChunkFile === computed.tailChunkFile
  ) {
    return false
  }

  await writeChunkIndexHeadTail(
    conversationId,
    bp,
    idx,
    computed.headChunkFile,
    computed.tailChunkFile,
  )
  return true
}

async function repairChunkIndexScope(
  conversationId: string,
  branchPath: string,
): Promise<ChunkIndexRepairResult & { ok: boolean }> {
  const bp = normalizeBranchPath(branchPath)
  const idx = bp
    ? await readBranchConversationIndex(conversationId, bp)
    : await readConversationIndex(conversationId)
  if (!idx) {
    return {
      ok: false,
      headChunkFile: null,
      tailChunkFile: null,
      repaired: false,
      brokenChain: false,
      chunkFileCount: 0,
    }
  }

  const computed = await rebuildHeadTailFromLinks(conversationId, bp)
  if (computed.brokenChain) {
    return { ok: false, ...computed }
  }

  if (computed.chunkFileCount === 0) {
    const needsClear = idx.headChunkFile !== null || idx.tailChunkFile !== null
    if (needsClear) {
      await writeChunkIndexHeadTail(conversationId, bp, idx, null, null)
    }
    return { ok: true, ...computed, repaired: needsClear }
  }

  const needsRepair =
    idx.headChunkFile !== computed.headChunkFile ||
    idx.tailChunkFile !== computed.tailChunkFile
  if (needsRepair) {
    await writeChunkIndexHeadTail(
      conversationId,
      bp,
      idx,
      computed.headChunkFile,
      computed.tailChunkFile,
    )
  }
  return { ok: true, ...computed, repaired: needsRepair }
}

/** 默认 5 分钟内不对同一会话重复全目录扫盘 */
export const CHUNK_INDEX_SYNC_TTL_MS = 5 * 60 * 1000

const chunkIndexSyncAt = new Map<string, number>()

export function invalidateChunkIndexSyncCache(conversationId: string): void {
  chunkIndexSyncAt.delete(conversationId)
}

/** 读盘时 index 与 links 不一致则静默修正（链断裂时不改）；热路径默认跳过，repair API 传 force */
export async function syncChunkIndexIfDrifted(
  conversationId: string,
  options?: { force?: boolean },
): Promise<boolean> {
  if (!options?.force) {
    const last = chunkIndexSyncAt.get(conversationId) ?? 0
    if (Date.now() - last < CHUNK_INDEX_SYNC_TTL_MS) {
      return false
    }
  }

  let repaired = await syncChunkIndexScopeIfDrifted(conversationId, '')
  const branchPaths = await collectRegisteredBranchPaths(conversationId)
  for (const bp of branchPaths) {
    repaired =
      (await syncChunkIndexScopeIfDrifted(conversationId, bp)) || repaired
  }

  chunkIndexSyncAt.set(conversationId, Date.now())
  return repaired
}

/** 显式修复 index.json 的 head/tail（调试 / repair API）；主路径 + 已注册分支子树 */
export async function repairConversationChunkIndex(
  conversationId: string,
): Promise<
  ChunkIndexRepairResult & { ok: boolean; branchScopesRepaired?: number }
> {
  invalidateChunkIndexSyncCache(conversationId)
  const rootIdx = await readConversationIndex(conversationId)
  if (!rootIdx) {
    return {
      ok: false,
      headChunkFile: null,
      tailChunkFile: null,
      repaired: false,
      brokenChain: false,
      chunkFileCount: 0,
    }
  }

  const branchPaths = await collectRegisteredBranchPaths(conversationId)
  const scopes = ['', ...branchPaths]
  let mainResult: (ChunkIndexRepairResult & { ok: boolean }) | null = null
  let branchScopesRepaired = 0
  let anyBroken = false

  for (const scope of scopes) {
    const result = await repairChunkIndexScope(conversationId, scope)
    if (!scope) mainResult = result
    if (!result.ok && result.brokenChain) anyBroken = true
    if (scope && result.repaired) branchScopesRepaired++
  }

  if (anyBroken) {
    return mainResult ?? {
      ok: false,
      headChunkFile: null,
      tailChunkFile: null,
      repaired: false,
      brokenChain: true,
      chunkFileCount: 0,
    }
  }

  chunkIndexSyncAt.set(conversationId, Date.now())
  const main = mainResult ?? {
    ok: true,
    headChunkFile: null,
    tailChunkFile: null,
    repaired: false,
    brokenChain: false,
    chunkFileCount: 0,
  }

  let branchLabelsRepaired = 0
  try {
    const { repairBranchRegistryLabelDrift } = await import(
      './conversation-branches.js'
    )
    branchLabelsRepaired = (
      await repairBranchRegistryLabelDrift(conversationId)
    ).repaired
  } catch {
    // ignore
  }

  return {
    ...main,
    ok: true,
    repaired:
      main.repaired || branchScopesRepaired > 0 || branchLabelsRepaired > 0,
    branchScopesRepaired,
  }
}

export type { ChunkSettings }
