import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'
import {
  conversationDir,
  readBranchConversationIndex,
  readConversationIndex,
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
  return [...out].sort()
}

export interface ChunkChainLocation {
  branchPath: string
  chunkFileName: string
}

function normalizeTailChunkBasename(
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

/** 沿 chunk 链按 turnId 定位块文件 */
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

export interface ReadTurnsTailResult {
  turns: TurnRecord[]
  hasMoreBefore: boolean
  minOrdinal: number | null
  maxOrdinal: number | null
}

/** 读取对话尾部最多 limit 轮（沿 tail → previous，仅加载相交 chunk） */
export async function readTurnsTail(
  conversationId: string,
  limit: number,
): Promise<ReadTurnsTailResult> {
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) {
    return {
      turns: [],
      hasMoreBefore: false,
      minOrdinal: null,
      maxOrdinal: null,
    }
  }
  const tailChunk = await readChunkFile(conversationId, idx.tailChunkFile)
  if (!tailChunk?.turns?.length) {
    return {
      turns: [],
      hasMoreBefore: !!tailChunk?.meta.links.previous,
      minOrdinal: null,
      maxOrdinal: null,
    }
  }
  const maxOrdinal = Math.max(...tailChunk.turns.map((t) => t.turnOrdinal))
  const { from, to, hasMoreBefore } = computeTailOrdinalReadRange(
    maxOrdinal,
    limit,
  )
  const turns = await readTurnsInOrdinalRange(conversationId, from, to)
  const minOrdinal =
    turns.length > 0 ? Math.min(...turns.map((t) => t.turnOrdinal)) : null
  return {
    turns,
    hasMoreBefore,
    minOrdinal,
    maxOrdinal,
  }
}

/** 加载与 [from,to] 可能相交的 chunk（每文件至多读一次） */
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

/** 仅读取 ordinal 闭区间 [from, to] 内的 turn（不加载全对话） */
export async function readTurnsInOrdinalRange(
  conversationId: string,
  from: number,
  to: number,
): Promise<TurnRecord[]> {
  if (from > to || from < 0) return []
  const chunks = await loadConversationChunksForOrdinalRange(conversationId, from, to)
  const collected: TurnRecord[] = []
  for (const chunk of chunks.values()) {
    for (const t of chunk.turns) {
      if (t.turnOrdinal >= from && t.turnOrdinal <= to) {
        collected.push(t)
      }
    }
  }
  return sortTurnsUnique(collected)
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
  oldTail: ChunkFile,
  oldFileName: string,
  newTurnsPerFile: number,
): Promise<{
  idx: ConversationIndex
  tailFile: string
  tail: ChunkFile
  sealedChunkFile: string
}> {
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
  await writeChunkFile(conversationId, oldFileName, oldTail)

  const newTail: ChunkFile = {
    schemaVersion: 1,
    meta,
    turns: [],
  }
  await writeChunkFile(conversationId, newFileName, newTail)

  idx.tailChunkFile = newFileName
  await writeConversationIndex(conversationId, idx)
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
): Promise<string[]> {
  const sealed: string[] = []
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return sealed
  const tailName = idx.tailChunkFile
  const tail = await readChunkFile(conversationId, tailName)
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
    await writeChunkFile(conversationId, prevFile, prevChunk)
    sealed.push(prevFile)

    const newChunk: ChunkFile = {
      schemaVersion: 1,
      meta,
      turns: group,
    }
    await writeChunkFile(conversationId, newFileName, newChunk)

    prevFile = newFileName
    prevChunk = newChunk
  }

  idx.tailChunkFile = prevFile
  if (!idx.headChunkFile) idx.headChunkFile = tailName
  await writeConversationIndex(conversationId, idx)
  return sealed
}

/**
 * append 前：迁移超大尾块、必要时滚动 tail。
 * 返回当前可写入的 tail 块与文件名。
 */
export async function prepareTailChunkForAppend(
  conversationId: string,
): Promise<{
  idx: ConversationIndex
  tailFile: string
  tail: ChunkFile
  /** 本次 prepare 中已封存、应对应 Lance optimize 的 chunk 文件 */
  sealedChunkFiles: string[]
} | null> {
  const sealedChunkFiles = await splitOversizedTailChunkIfNeeded(conversationId)
  let idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return null
  let tailFile = idx.tailChunkFile
  let tail = await readChunkFile(conversationId, tailFile)
  if (!tail) return null

  if (!isChunkFull(tail, tailFile)) {
    return { idx, tailFile, tail, sealedChunkFiles }
  }

  const global = await readGlobalChunkSettings()
  const rotated = await rotateTailChunk(
    conversationId,
    idx,
    tail,
    tailFile,
    global.turnsPerFile,
  )
  return {
    idx: rotated.idx,
    tailFile: rotated.tailFile,
    tail: rotated.tail,
    sealedChunkFiles: [...sealedChunkFiles, rotated.sealedChunkFile],
  }
}

export async function readChunkContainingOrdinal(
  conversationId: string,
  turnOrdinal: number,
): Promise<{ chunk: ChunkFile; fileName: string } | null> {
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return null
  let fileName: string | null = idx.tailChunkFile
  const guard = new Set<string>()
  while (fileName) {
    if (guard.has(fileName)) break
    guard.add(fileName)
    const chunk = await readChunkFile(conversationId, fileName)
    if (!chunk) return null
    if (chunk.turns.some((t) => t.turnOrdinal === turnOrdinal)) {
      return { chunk, fileName }
    }
    fileName = chunk.meta.links.previous
  }
  return null
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

async function loadMainPathChunkLinkGraph(
  conversationId: string,
): Promise<Map<string, { previous: string | null; next: string | null }>> {
  const dir = conversationDir(conversationId)
  let entries: string[]
  try {
    entries = await readdir(dir)
  } catch {
    return new Map()
  }
  const graph = new Map<string, { previous: string | null; next: string | null }>()
  for (const name of entries) {
    if (!TURN_CHUNK_FILE_RE.test(name)) continue
    const chunk = await readChunkFile(conversationId, name)
    if (!chunk) continue
    graph.set(name, {
      previous: chunk.meta.links.previous ?? null,
      next: chunk.meta.links.next ?? null,
    })
  }
  return graph
}

/** 扫描 `turn-*.json` 的 meta.links，计算 head/tail（不写盘） */
export async function rebuildHeadTailFromLinks(
  conversationId: string,
): Promise<ChunkIndexRepairResult> {
  const graph = await loadMainPathChunkLinkGraph(conversationId)
  const { head, tail, broken } = computeHeadTailFromLinks(graph)
  return {
    headChunkFile: head,
    tailChunkFile: tail,
    repaired: false,
    brokenChain: broken,
    chunkFileCount: graph.size,
  }
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
  const idx = await readConversationIndex(conversationId)
  if (!idx) return false
  const computed = await rebuildHeadTailFromLinks(conversationId)
  if (computed.brokenChain) {
    chunkIndexSyncAt.set(conversationId, Date.now())
    return false
  }
  if (computed.chunkFileCount === 0) {
    if (idx.headChunkFile !== null || idx.tailChunkFile !== null) {
      idx.headChunkFile = null
      idx.tailChunkFile = null
      idx.updatedAt = new Date().toISOString()
      await writeConversationIndex(conversationId, idx)
      chunkIndexSyncAt.set(conversationId, Date.now())
      return true
    }
    chunkIndexSyncAt.set(conversationId, Date.now())
    return false
  }
  if (
    idx.headChunkFile === computed.headChunkFile &&
    idx.tailChunkFile === computed.tailChunkFile
  ) {
    chunkIndexSyncAt.set(conversationId, Date.now())
    return false
  }
  idx.headChunkFile = computed.headChunkFile
  idx.tailChunkFile = computed.tailChunkFile
  idx.updatedAt = new Date().toISOString()
  await writeConversationIndex(conversationId, idx)
  chunkIndexSyncAt.set(conversationId, Date.now())
  return true
}

/** 显式修复 index.json 的 head/tail（调试 / repair API） */
export async function repairConversationChunkIndex(
  conversationId: string,
): Promise<ChunkIndexRepairResult & { ok: boolean }> {
  invalidateChunkIndexSyncCache(conversationId)
  const idx = await readConversationIndex(conversationId)
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
  const computed = await rebuildHeadTailFromLinks(conversationId)
  if (computed.brokenChain) {
    return { ok: false, ...computed }
  }
  if (computed.chunkFileCount === 0) {
    const needsClear = idx.headChunkFile !== null || idx.tailChunkFile !== null
    if (needsClear) {
      idx.headChunkFile = null
      idx.tailChunkFile = null
      idx.updatedAt = new Date().toISOString()
      await writeConversationIndex(conversationId, idx)
    }
    return { ok: true, ...computed, repaired: needsClear }
  }
  const needsRepair =
    idx.headChunkFile !== computed.headChunkFile ||
    idx.tailChunkFile !== computed.tailChunkFile
  if (needsRepair) {
    idx.headChunkFile = computed.headChunkFile
    idx.tailChunkFile = computed.tailChunkFile
    idx.updatedAt = new Date().toISOString()
    await writeConversationIndex(conversationId, idx)
  }
  chunkIndexSyncAt.set(conversationId, Date.now())
  return { ok: true, ...computed, repaired: needsRepair }
}

export type { ChunkSettings }
