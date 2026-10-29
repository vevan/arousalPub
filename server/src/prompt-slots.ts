/**
 * §14.4.1 PromptSlot 中间态：包壳 →（宏/正则由调用方）→ 记账 → 裁切 → 投影。
 * 合并槽（lore/memory/knowledge）对外仍一条 system；可裁单位在 parts[]。
 */
import type { ChatMessage } from './assemble-prompts.js'
import type { TurnRecord } from './chat-turn-types.js'
import type { KnowledgeHitItem } from './knowledge-resolve.js'
import { formatKnowledgeXml } from './knowledge-xml.js'
import {
  type BudgetTrimSettings,
  type BudgetTrimSlot,
} from './budget-trim-settings.js'
import {
  countChatMessageFrameTokens,
  countChatMessagesTokens,
  type TokenCountOptions,
} from './token-count.js'
import { turnToXmlInner } from './turn-memory-xml.js'
import { formatLoreEntryLines } from './prompt-xml.js'
import type {
  ConstantLoreItem,
  PromptBudgetTrimResult,
  PromptBudgetTrimState,
  TrimmableLoreEntry,
} from './prompt-budget-trim.js'
import { resolveEntryPosition } from './lorebook-entry-utils.js'
import type { LorebookEntryPosition } from './lorebook-types.js'

export type PromptSlotKind =
  | 'prompt'
  | 'persona'
  | 'lore'
  | 'memory'
  | 'knowledge'
  | 'history'
  | 'userInput'
  | 'plugin'

/** 合并槽内可裁/不可裁片段（进数组前已包好的 XML 片段） */
export interface PromptSlotPart {
  id: string
  /** 已包壳片段（位于 prefix/suffix 之间） */
  body: string
  trimmable: boolean
  /** 越小越先删（lore score 等） */
  rank: number
  turnOrdinal?: number
}

export interface AtomicPromptSlot {
  kind: Exclude<PromptSlotKind, 'lore' | 'memory' | 'knowledge'>
  role: ChatMessage['role']
  content: string
  /** 本条 message 帧 token */
  tokens: number
  trimmable: boolean
  turnOrdinal?: number
  turnId?: string
}

export interface MergePromptSlot {
  kind: 'lore' | 'memory' | 'knowledge'
  role: 'system'
  prefix: string
  suffix: string
  parts: PromptSlotPart[]
  /** prefix+parts+suffix 作为一条 system 的帧 token */
  frameTokens: number
}

export type PromptSlot = AtomicPromptSlot | MergePromptSlot

export function isMergeSlot(slot: PromptSlot): slot is MergePromptSlot {
  return slot.kind === 'lore' || slot.kind === 'memory' || slot.kind === 'knowledge'
}

export function mergeSlotContent(slot: MergePromptSlot): string {
  if (slot.parts.length === 0) return ''
  // 无损切片时分隔空白已在 body 内；build* 路径经 attachPartSeparators 补 `\n`
  return `${slot.prefix}${slot.parts.map((p) => p.body).join('')}${slot.suffix}`
}

/** build*：在相邻 part 之间写入 `\\n`（末 part 不加），与 sliceXmlChildParts 拼接约定一致 */
function attachPartSeparators(parts: PromptSlotPart[]): void {
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!
    if (!p.body.endsWith('\n')) p.body += '\n'
  }
}

export function recountMergeSlotFrameTokens(
  slot: MergePromptSlot,
  options?: TokenCountOptions,
): number {
  const content = mergeSlotContent(slot)
  if (!content) {
    slot.frameTokens = 0
    return 0
  }
  slot.frameTokens = countChatMessageFrameTokens(
    { role: slot.role, content },
    options,
  )
  return slot.frameTokens
}

export function recountAtomicSlotTokens(
  slot: AtomicPromptSlot,
  options?: TokenCountOptions,
): number {
  slot.tokens = countChatMessageFrameTokens(
    { role: slot.role, content: slot.content },
    options,
  )
  return slot.tokens
}

/** 去掉已无 `<lore>` 的空 `<lorebook>…</lorebook>`（裁切后投影用） */
export function stripEmptyLorebookElements(xml: string): string {
  let cur = xml
  let prev = ''
  while (cur !== prev) {
    prev = cur
    cur = cur.replace(/<lorebook(\s[^>]*)?>\s*<\/lorebook>/gi, '')
  }
  return cur
}

/** 各槽帧之和（不含 priming +3） */
function sumPromptSlotFrames(slots: readonly PromptSlot[]): number {
  let n = 0
  for (const s of slots) {
    if (isMergeSlot(s)) {
      if (s.parts.length === 0) continue
      n += s.frameTokens
    } else {
      n += s.tokens
    }
  }
  return n
}

function withChatPriming(frameSum: number): number {
  if (frameSum <= 0) return 0
  return frameSum + 3
}

/** 各槽帧之和 + Chat Completions 末尾 priming */
export function totalPromptSlotTokens(
  slots: readonly PromptSlot[],
  _options?: TokenCountOptions,
): number {
  void _options
  return withChatPriming(sumPromptSlotFrames(slots))
}

export function projectPromptSlotsToMessages(
  slots: readonly PromptSlot[],
): ChatMessage[] {
  const out: ChatMessage[] = []
  for (const s of slots) {
    if (isMergeSlot(s)) {
      let content = mergeSlotContent(s)
      if (s.kind === 'lore') content = stripEmptyLorebookElements(content)
      if (!content.trim()) continue
      out.push({ role: s.role, content })
      continue
    }
    if (!s.content.trim()) continue
    out.push({
      role: s.role,
      content: s.content,
      ...(s.turnOrdinal != null ? { turnOrdinal: s.turnOrdinal } : {}),
      ...(s.turnId ? { turnId: s.turnId } : {}),
    })
  }
  return out
}

function countTrimmableParts(
  slots: readonly PromptSlot[],
  kind: 'lore' | 'memory' | 'knowledge',
): number {
  let n = 0
  for (const s of slots) {
    if (!isMergeSlot(s) || s.kind !== kind) continue
    for (const p of s.parts) {
      if (p.trimmable) n += 1
    }
  }
  return n
}

function countHistorySlots(slots: readonly PromptSlot[]): number {
  return slots.filter((s) => !isMergeSlot(s) && s.kind === 'history').length
}

/**
 * 删最低 rank 的 trimmable part（memory 的 rank=turnOrdinal，越早越小）。
 * @returns 节省的帧 token；无法删则 null
 */
function dropLowestRankPart(
  slots: PromptSlot[],
  kind: 'lore' | 'memory' | 'knowledge',
  minRetain: number,
  options?: TokenCountOptions,
): number | null {
  if (countTrimmableParts(slots, kind) <= minRetain) return null
  let best: { slotIdx: number; partIdx: number; rank: number } | null = null
  for (let si = 0; si < slots.length; si++) {
    const s = slots[si]!
    if (!isMergeSlot(s) || s.kind !== kind) continue
    for (let pi = 0; pi < s.parts.length; pi++) {
      const p = s.parts[pi]!
      if (!p.trimmable) continue
      if (!best || p.rank < best.rank) {
        best = { slotIdx: si, partIdx: pi, rank: p.rank }
      }
    }
  }
  if (!best) return null
  const slot = slots[best.slotIdx] as MergePromptSlot
  const before = slot.frameTokens
  slot.parts.splice(best.partIdx, 1)
  const after = recountMergeSlotFrameTokens(slot, options)
  return Math.max(0, before - after)
}

function dropOldestHistorySlot(
  slots: PromptSlot[],
  minRetain: number,
): number | null {
  if (countHistorySlots(slots) <= minRetain) return null
  const idx = slots.findIndex((s) => !isMergeSlot(s) && s.kind === 'history')
  if (idx < 0) return null
  const slot = slots[idx] as AtomicPromptSlot
  const delta = slot.tokens
  slots.splice(idx, 1)
  return delta
}

function trimOnePromptSlotKindDelta(
  slots: PromptSlot[],
  kind: BudgetTrimSlot,
  settings: BudgetTrimSettings,
  options?: TokenCountOptions,
): number | null {
  switch (kind) {
    case 'knowledge':
      return dropLowestRankPart(
        slots,
        'knowledge',
        settings.minRetain.knowledge,
        options,
      )
    case 'lore':
      return dropLowestRankPart(
        slots,
        'lore',
        settings.minRetain.lore,
        options,
      )
    case 'memory':
      return dropLowestRankPart(
        slots,
        'memory',
        settings.minRetain.memory,
        options,
      )
    case 'history':
      return dropOldestHistorySlot(slots, settings.minRetain.history)
  }
}

/**
 * 按 trimOrder 轮询删一条；返回 kind 与帧 Δ（旧帧−新帧）。
 */
export function trimOnePromptSlotRoundRobin(
  slots: PromptSlot[],
  settings: BudgetTrimSettings,
  cursor: { index: number },
  options?: TokenCountOptions,
): { kind: BudgetTrimSlot; deltaFrames: number } | null {
  const order = settings.trimOrder
  const n = order.length
  if (n === 0) return null
  const start = ((cursor.index % n) + n) % n
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n
    const kind = order[idx]!
    const delta = trimOnePromptSlotKindDelta(slots, kind, settings, options)
    if (delta == null) continue
    cursor.index = (idx + 1) % n
    return { kind, deltaFrames: delta }
  }
  return null
}

function recordDrop(
  drops: PromptBudgetTrimResult,
  kind: BudgetTrimSlot,
): void {
  switch (kind) {
    case 'knowledge':
      drops.droppedKnowledgeCount += 1
      break
    case 'lore':
      drops.droppedLoreCount += 1
      break
    case 'memory':
      drops.droppedMemoryCount += 1
      break
    case 'history':
      break
  }
}

/**
 * 已对槽完成宏/正则与 token 计数后：按账本 Δ 扣减裁切，循环内不投影、不全量重算。
 */
export function runPromptSlotBudgetTrim(opts: {
  slots: PromptSlot[]
  maxTokens: number
  trimSettings: BudgetTrimSettings
  tokenOpt?: TokenCountOptions
}): {
  slots: PromptSlot[]
  drops: PromptBudgetTrimResult
  tokensBeforeTrim: number
  estimatedTokens: number
} {
  const drops: PromptBudgetTrimResult = {
    droppedLoreCount: 0,
    droppedMemoryCount: 0,
    droppedKnowledgeCount: 0,
  }
  const tokenOpt = opts.tokenOpt ?? {}
  let frameSum = sumPromptSlotFrames(opts.slots)
  let remaining = withChatPriming(frameSum)
  const tokensBeforeTrim = remaining
  const budget = Math.floor(opts.maxTokens)
  if (!Number.isFinite(budget) || budget <= 0 || remaining <= budget) {
    return {
      slots: opts.slots,
      drops,
      tokensBeforeTrim,
      estimatedTokens: remaining,
    }
  }

  const MAX_ROUNDS = 512
  const rrCursor = { index: 0 }
  for (let round = 0; round < MAX_ROUNDS && remaining > budget; round++) {
    const hit = trimOnePromptSlotRoundRobin(
      opts.slots,
      opts.trimSettings,
      rrCursor,
      tokenOpt,
    )
    if (!hit) break
    // Δ=0 仍记 drop（正文已删），继续试其它槽，勿整轮 break
    if (hit.deltaFrames > 0) {
      frameSum = Math.max(0, frameSum - hit.deltaFrames)
      remaining = withChatPriming(frameSum)
    }
    recordDrop(drops, hit.kind)
  }

  return {
    slots: opts.slots,
    drops,
    tokensBeforeTrim,
    estimatedTokens: remaining,
  }
}

// ——— 从 trim state 构建合并槽 / history（包壳后进数组）———

function lorePartBody(entry: { title: string; content: string }): string {
  const lines = formatLoreEntryLines(
    [{ name: entry.title.trim() || '未命名', content: entry.content }],
    '  ',
  )
  return lines.join('\n')
}

function pushByTitle<T extends { entry: { title: string; id: string } }>(
  map: Map<string, T[]>,
  item: T,
): void {
  const title = item.entry.title.trim() || '未命名'
  const list = map.get(title)
  if (list) list.push(item)
  else map.set(title, [item])
}

function takeUnusedByTitle<T extends { entry: { id: string } }>(
  map: Map<string, T[]>,
  title: string,
  usedIds: Set<string>,
): T | undefined {
  const list = map.get(title)
  if (!list) return undefined
  for (const item of list) {
    if (usedIds.has(item.entry.id)) continue
    usedIds.add(item.entry.id)
    return item
  }
  return undefined
}

export function buildLoreMergeSlot(
  constant: readonly ConstantLoreItem[],
  matched: readonly TrimmableLoreEntry[],
  position: LorebookEntryPosition,
  options?: TokenCountOptions,
): MergePromptSlot | null {
  const parts: PromptSlotPart[] = []
  for (const c of constant) {
    if (resolveEntryPosition(c.entry) !== position) continue
    const body = lorePartBody(c.entry)
    if (!body) continue
    parts.push({
      id: `const:${c.entry.id}`,
      body,
      trimmable: false,
      rank: Number.POSITIVE_INFINITY,
    })
  }
  for (const m of matched) {
    if (resolveEntryPosition(m.entry) !== position) continue
    const body = lorePartBody(m.entry)
    if (!body) continue
    parts.push({
      id: `match:${m.entry.id}`,
      body,
      trimmable: true,
      rank: m.score,
    })
  }
  if (parts.length === 0) return null
  attachPartSeparators(parts)
  const slot: MergePromptSlot = {
    kind: 'lore',
    role: 'system',
    prefix: '<lores>\n',
    suffix: '\n</lores>',
    parts,
    frameTokens: 0,
  }
  recountMergeSlotFrameTokens(slot, options)
  return slot
}

export function buildMemoryMergeSlot(
  items: readonly { turn: TurnRecord; score: number }[],
  options?: TokenCountOptions,
): MergePromptSlot | null {
  if (!items.length) return null
  const sorted = items
    .slice()
    .sort((a, b) => a.turn.turnOrdinal - b.turn.turnOrdinal)
  const parts: PromptSlotPart[] = sorted.map((it) => ({
    id: it.turn.turnId,
    body: turnToXmlInner(it.turn, {
      correlation: it.score,
      omitTurnId: true,
    }),
    trimmable: true,
    rank: it.turn.turnOrdinal,
    turnOrdinal: it.turn.turnOrdinal,
  }))
  attachPartSeparators(parts)
  const slot: MergePromptSlot = {
    kind: 'memory',
    role: 'system',
    prefix: '<memory>\n',
    suffix: '\n</memory>',
    parts,
    frameTokens: 0,
  }
  recountMergeSlotFrameTokens(slot, options)
  return slot
}

export function buildKnowledgeMergeSlot(
  items: readonly KnowledgeHitItem[],
  options?: TokenCountOptions,
): MergePromptSlot | null {
  if (!items.length) return null
  const parts: PromptSlotPart[] = items.map((it, i) => {
    const chunkXml = formatKnowledgeXml([
      {
        kbName: it.kbName,
        fileName: it.fileName,
        ordinal: it.ordinal,
        text: it.text,
      },
    ])
    // 去掉根标签，只留 chunk 块作为 part
    const body = chunkXml
      .replace(/^<knowledge>\n?/, '')
      .replace(/\n?<\/knowledge>\s*$/, '')
    return {
      id: it.chunkId || `${it.kbId}:${it.fileId}:${it.ordinal}:${i}`,
      body,
      trimmable: true,
      rank: it.score,
    }
  })
  attachPartSeparators(parts)
  const slot: MergePromptSlot = {
    kind: 'knowledge',
    role: 'system',
    prefix: '<knowledge>\n',
    suffix: '\n</knowledge>',
    parts,
    frameTokens: 0,
  }
  recountMergeSlotFrameTokens(slot, options)
  return slot
}

export function buildHistoryAtomicSlots(
  messages: readonly ChatMessage[],
  options?: TokenCountOptions,
): AtomicPromptSlot[] {
  return messages.map((m, i) => {
    const slot: AtomicPromptSlot = {
      kind: 'history',
      role: m.role,
      content: m.content,
      tokens: 0,
      trimmable: true,
      turnOrdinal: m.turnOrdinal,
      turnId: m.turnId,
    }
    recountAtomicSlotTokens(slot, options)
    void i
    return slot
  })
}

/** 校验：投影后的 messages token 与槽账本一致（同口径） */
export function assertSlotLedgerMatchesProjection(
  slots: readonly PromptSlot[],
  options?: TokenCountOptions,
): { ledger: number; projected: number } {
  const ledger = totalPromptSlotTokens(slots, options)
  const projected = countChatMessagesTokens(
    projectPromptSlotsToMessages(slots),
    options,
  )
  return { ledger, projected }
}

/**
 * 将裁切后的可裁槽写回 PromptBudgetTrimState。
 * 仅同步「槽数组中出现过」的类别，避免 messages 未含某类 XML 时误清空 state。
 */
export function syncTrimStateFromTrimmableSlots(
  state: PromptBudgetTrimState,
  slots: readonly PromptSlot[],
): void {
  const matchIds = new Set<string>()
  const constIds = new Set<string>()
  const memoryIds = new Set<string>()
  const knowledgeIds = new Set<string>()
  const history: ChatMessage[] = []
  let sawLore = false
  let sawMemory = false
  let sawKnowledge = false
  let sawHistory = false

  for (const s of slots) {
    if (isMergeSlot(s)) {
      if (s.kind === 'lore') {
        sawLore = true
        for (const p of s.parts) {
          if (p.id.startsWith('match:')) matchIds.add(p.id.slice('match:'.length))
          else if (p.id.startsWith('const:'))
            constIds.add(p.id.slice('const:'.length))
        }
      } else if (s.kind === 'memory') {
        sawMemory = true
        for (const p of s.parts) memoryIds.add(p.id)
      } else if (s.kind === 'knowledge') {
        sawKnowledge = true
        for (const p of s.parts) knowledgeIds.add(p.id)
      }
      continue
    }
    if (s.kind === 'history') {
      sawHistory = true
      history.push({
        role: s.role,
        content: s.content,
        ...(s.turnOrdinal != null ? { turnOrdinal: s.turnOrdinal } : {}),
        ...(s.turnId ? { turnId: s.turnId } : {}),
      })
    }
  }

  if (sawLore) {
    state.matchedLore = state.matchedLore.filter((m) =>
      matchIds.has(m.entry.id),
    )
    state.constantLore = state.constantLore.filter((c) =>
      constIds.has(c.entry.id),
    )
  }
  if (sawMemory) {
    state.memoryItems = state.memoryItems.filter((m) =>
      memoryIds.has(m.turn.turnId),
    )
  }
  if (sawKnowledge) {
    state.knowledgeItems = state.knowledgeItems.filter((k, i) => {
      const composite = `${k.kbId}:${k.fileId}:${k.ordinal}:${i}`
      if (k.chunkId && knowledgeIds.has(k.chunkId)) return true
      if (knowledgeIds.has(composite)) return true
      const prefix = `${k.kbId}:${k.fileId}:${k.ordinal}`
      for (const id of knowledgeIds) {
        if (id.startsWith(prefix)) return true
      }
      return false
    })
  }
  if (sawHistory) {
    state.historyMessages = history
  }
}

/**
 * 从原文按 child 标签无损切片。
 * - `absorbTrailing`: 将下一 child 之前的原文并入当前 part（适合扁平 turn/chunk）。
 * - 否则 child 之间插入不可裁 glue（适合 `<lores>` 内跨 `<lorebook>` 仍按条 `<lore>` 裁）。
 */
function sliceXmlChildParts(
  content: string,
  root: string,
  childTag: string,
  mode: 'absorbTrailing' | 'glueBetween' = 'absorbTrailing',
): {
  prefix: string
  parts: { body: string; role: 'child' | 'glue' }[]
  suffix: string
} | null {
  const openRe = new RegExp(`<${root}(\\s[^>]*)?>`, 'i')
  const closeRe = new RegExp(`</${root}>`, 'i')
  const openM = openRe.exec(content)
  if (!openM) return null
  const afterOpen = openM.index + openM[0].length
  const closeM = closeRe.exec(content.slice(afterOpen))
  if (!closeM) return null
  const closeIdx = afterOpen + closeM.index
  const inner = content.slice(afterOpen, closeIdx)
  const childRe = new RegExp(`<${childTag}\\b[\\s\\S]*?</${childTag}>`, 'gi')
  const spans: { start: number; end: number }[] = []
  let m: RegExpExecArray | null
  while ((m = childRe.exec(inner)) !== null) {
    spans.push({ start: m.index, end: m.index + m[0].length })
  }
  if (spans.length === 0) return null
  const prefix = content.slice(0, afterOpen + spans[0]!.start)
  const parts: { body: string; role: 'child' | 'glue' }[] = []
  for (let i = 0; i < spans.length; i++) {
    const childBody = inner.slice(spans[i]!.start, spans[i]!.end)
    if (mode === 'absorbTrailing') {
      const end =
        i + 1 < spans.length ? spans[i + 1]!.start : spans[i]!.end
      parts.push({ body: inner.slice(spans[i]!.start, end), role: 'child' })
    } else {
      parts.push({ body: childBody, role: 'child' })
      if (i + 1 < spans.length) {
        const glue = inner.slice(spans[i]!.end, spans[i + 1]!.start)
        if (glue.length > 0) {
          parts.push({ body: glue, role: 'glue' })
        }
      }
    }
  }
  const suffix = content.slice(afterOpen + spans[spans.length - 1]!.end)
  return { prefix, parts, suffix }
}

function mergeSlotFromMemoryXml(
  content: string,
  state: PromptBudgetTrimState,
  options?: TokenCountOptions,
): MergePromptSlot | null {
  const sliced = sliceXmlChildParts(content, 'memory', 'turn', 'absorbTrailing')
  if (!sliced) return null
  const parts: PromptSlotPart[] = sliced.parts.map((seg, i) => {
    const body = seg.body
    const ordM = /ordinal="(\d+)"/i.exec(body)
    const ord = ordM ? Number(ordM[1]) : i
    const hit = state.memoryItems.find((x) => x.turn.turnOrdinal === ord)
    return {
      id: hit?.turn.turnId ?? `mem:${ord}`,
      body,
      trimmable: true,
      rank: ord,
      turnOrdinal: ord,
    }
  })
  const slot: MergePromptSlot = {
    kind: 'memory',
    role: 'system',
    prefix: sliced.prefix,
    suffix: sliced.suffix,
    parts,
    frameTokens: 0,
  }
  recountMergeSlotFrameTokens(slot, options)
  return slot
}

function mergeSlotFromLoresXml(
  content: string,
  state: PromptBudgetTrimState,
  options?: TokenCountOptions,
): MergePromptSlot | null {
  // 始终按 <lore> 条切；多本 <lorebook> 壳进 prefix/glue/suffix，避免整本删
  const sliced = sliceXmlChildParts(content, 'lores', 'lore', 'glueBetween')
  if (!sliced) return null
  const matchedByTitle = new Map<string, TrimmableLoreEntry[]>()
  for (const m of state.matchedLore) pushByTitle(matchedByTitle, m)
  const constByTitle = new Map<string, ConstantLoreItem[]>()
  for (const c of state.constantLore) pushByTitle(constByTitle, c)
  const usedConstIds = new Set<string>()
  const usedMatchIds = new Set<string>()
  let lorePartIdx = 0
  let glueIdx = 0
  const parts: PromptSlotPart[] = sliced.parts.map((seg) => {
    if (seg.role === 'glue') {
      return {
        id: `glue:${glueIdx++}`,
        body: seg.body,
        trimmable: false,
        rank: Number.POSITIVE_INFINITY,
      }
    }
    const body = seg.body
    const i = lorePartIdx++
    const nameM = /name="([^"]*)"/i.exec(body)
    const title = (nameM?.[1] ?? '').trim() || '未命名'
    const asConst = takeUnusedByTitle(constByTitle, title, usedConstIds)
    if (asConst) {
      return {
        id: `const:${asConst.entry.id}`,
        body,
        trimmable: false,
        rank: Number.POSITIVE_INFINITY,
      }
    }
    const asMatch =
      takeUnusedByTitle(matchedByTitle, title, usedMatchIds) ??
      state.matchedLore.find((m) => !usedMatchIds.has(m.entry.id))
    if (asMatch) {
      usedMatchIds.add(asMatch.entry.id)
      return {
        id: `match:${asMatch.entry.id}`,
        body,
        trimmable: true,
        rank: asMatch.score,
      }
    }
    return {
      id: `lore:${i}`,
      body,
      trimmable: true,
      rank: i,
    }
  })
  const slot: MergePromptSlot = {
    kind: 'lore',
    role: 'system',
    prefix: sliced.prefix,
    suffix: sliced.suffix,
    parts,
    frameTokens: 0,
  }
  recountMergeSlotFrameTokens(slot, options)
  return slot
}

function mergeSlotFromKnowledgeXml(
  content: string,
  state: PromptBudgetTrimState,
  options?: TokenCountOptions,
): MergePromptSlot | null {
  const sliced = sliceXmlChildParts(
    content,
    'knowledge',
    'chunk',
    'absorbTrailing',
  )
  if (!sliced) return null
  let childIdx = 0
  const parts: PromptSlotPart[] = sliced.parts.map((seg) => {
    const i = childIdx++
    const item = state.knowledgeItems[i]
    return {
      id: item?.chunkId || `${item?.kbId ?? 'k'}:${i}`,
      body: seg.body,
      trimmable: true,
      rank: item?.score ?? i,
    }
  })
  const slot: MergePromptSlot = {
    kind: 'knowledge',
    role: 'system',
    prefix: sliced.prefix,
    suffix: sliced.suffix,
    parts,
    frameTokens: 0,
  }
  recountMergeSlotFrameTokens(slot, options)
  return slot
}

/**
 * 将已插件→宏→regex 的 messages 转为 PromptSlot[]。
 * 可合并 XML 按正文切 parts（切失败则整条不可裁，不回退 state 重建）；
 * history 靠 turnOrdinal 或与 state.historyMessages 顺序对齐；其余不可裁。
 */
export function slotsFromAssembledMessages(
  messages: readonly ChatMessage[],
  state: PromptBudgetTrimState,
  options?: TokenCountOptions,
): PromptSlot[] {
  const out: PromptSlot[] = []
  let histCursor = 0
  for (const msg of messages) {
    const raw = msg.content ?? ''
    const t = raw.trimStart()
    if (t.startsWith('<memory')) {
      const s = mergeSlotFromMemoryXml(raw, state, options)
      if (s) {
        out.push(s)
        continue
      }
    }
    if (t.startsWith('<lores')) {
      const s = mergeSlotFromLoresXml(raw, state, options)
      if (s) {
        out.push(s)
        continue
      }
    }
    if (t.startsWith('<knowledge')) {
      const s = mergeSlotFromKnowledgeXml(raw, state, options)
      if (s) {
        out.push(s)
        continue
      }
    }

    let matchedState: (typeof state.historyMessages)[number] | undefined
    let asHistory = false
    if (typeof msg.turnOrdinal === 'number') {
      asHistory = true
      while (
        histCursor < state.historyMessages.length &&
        typeof state.historyMessages[histCursor]!.turnOrdinal === 'number' &&
        state.historyMessages[histCursor]!.turnOrdinal! < msg.turnOrdinal
      ) {
        histCursor += 1
      }
      const at = state.historyMessages[histCursor]
      if (at?.turnOrdinal === msg.turnOrdinal) {
        matchedState = at
        histCursor += 1
      }
    } else {
      const stateHist = state.historyMessages[histCursor]
      if (
        stateHist != null &&
        stateHist.role === msg.role &&
        stateHist.content === raw
      ) {
        asHistory = true
        matchedState = stateHist
        histCursor += 1
      }
    }

    if (asHistory) {
      const slot: AtomicPromptSlot = {
        kind: 'history',
        role: msg.role,
        content: raw,
        tokens: 0,
        trimmable: true,
        turnOrdinal:
          typeof msg.turnOrdinal === 'number'
            ? msg.turnOrdinal
            : matchedState?.turnOrdinal,
        turnId: msg.turnId ?? matchedState?.turnId,
      }
      recountAtomicSlotTokens(slot, options)
      out.push(slot)
      continue
    }
    const slot: AtomicPromptSlot = {
      kind: 'prompt',
      role: msg.role,
      content: raw,
      tokens: 0,
      trimmable: false,
    }
    recountAtomicSlotTokens(slot, options)
    out.push(slot)
  }
  return out
}

/**
 * 对已插件→宏→regex 的 messages 做 PromptSlot 账本裁切并投影。
 * 循环内不 assemble、用帧 Δ 扣减；assemblePasses 恒为 0。
 */
export function trimAssembledMessagesWithPromptSlots(opts: {
  messages: ChatMessage[]
  state: PromptBudgetTrimState
  maxTokens: number
  trimSettings: BudgetTrimSettings
  tokenModel?: string
}): {
  messages: ChatMessage[]
  estimatedTokens: number
  drops: PromptBudgetTrimResult
  tokensBeforeTrim: number
  /** 本函数内无 assemble；保留字段以兼容审计 */
  assemblePasses: number
} {
  const contentTokenCache = new Map<string, number>()
  const tokenOpt: TokenCountOptions = {
    model: opts.tokenModel,
    contentTokenCache,
  }
  const tokensBeforeTrim = countChatMessagesTokens(opts.messages, tokenOpt)
  const budget = Math.floor(opts.maxTokens)
  if (
    !Number.isFinite(budget) ||
    budget <= 0 ||
    tokensBeforeTrim <= budget
  ) {
    return {
      messages: opts.messages,
      estimatedTokens: tokensBeforeTrim,
      drops: {
        droppedLoreCount: 0,
        droppedMemoryCount: 0,
        droppedKnowledgeCount: 0,
      },
      tokensBeforeTrim,
      assemblePasses: 0,
    }
  }

  const slots = slotsFromAssembledMessages(
    opts.messages,
    opts.state,
    tokenOpt,
  )
  const trimmed = runPromptSlotBudgetTrim({
    slots,
    maxTokens: budget,
    trimSettings: opts.trimSettings,
    tokenOpt,
  })
  syncTrimStateFromTrimmableSlots(opts.state, trimmed.slots)
  const messages = projectPromptSlotsToMessages(trimmed.slots)
  const estimatedTokens = countChatMessagesTokens(messages, tokenOpt)
  return {
    messages,
    estimatedTokens,
    drops: trimmed.drops,
    tokensBeforeTrim,
    assemblePasses: 0,
  }
}
