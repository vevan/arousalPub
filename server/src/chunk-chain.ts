import { readFile } from 'node:fs/promises'
import path from 'node:path'
import {
  conversationDir,
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

/** 从 tail 沿 previous 列出 chunk 文件名（旧 → 新） */
export async function listChunkFileNames(
  conversationId: string,
): Promise<string[]> {
  const idx = await readConversationIndex(conversationId)
  if (!idx?.tailChunkFile) return []
  const reversed: string[] = []
  let fileName: string | null = idx.tailChunkFile
  const guard = new Set<string>()
  while (fileName) {
    if (guard.has(fileName)) break
    guard.add(fileName)
    reversed.push(fileName)
    const chunk = await readChunkFile(conversationId, fileName)
    fileName = chunk?.meta.links.previous ?? null
  }
  return reversed.reverse()
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

/** 从 tail 沿 previous 读取全链 turn */
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

export type { ChunkSettings }
