import type { ChatMessage } from './assemble-prompts.js'
import type { TurnRecord } from './chat-turn-types.js'
import type {
  LorebookEntry,
  LorebookEntryPosition,
} from './lorebook-types.js'
import { resolveEntryPosition } from './lorebook-entry-utils.js'
import {
  type BudgetTrimSettings,
  type BudgetTrimSlot,
} from './budget-trim-settings.js'
import { countChatMessagesTokens, type TokenCountOptions } from './token-count.js'
import { trimAssembledMessagesWithPromptSlots } from './prompt-slots.js'
import { formatMemoryXml } from './turn-memory-xml.js'
import {
  formatLoresInjectionXml,
  type LorebookXmlGroup,
} from './prompt-xml.js'
import { formatKnowledgeXml } from './knowledge-xml.js'
import type { KnowledgeHitItem } from './knowledge-resolve.js'

/** 恒定注入 lore（带完整 entry，便于按 position 拆桶） */
export type ConstantLoreItem = {
  lorebookId: string
  lorebookName: string
  entry: LorebookEntry
}

/** 可裁切资料库条目（keyword / vector；不含 constant） */
export interface TrimmableLoreEntry {
  lorebookId: string
  lorebookName: string
  entry: LorebookEntry
  mode: 'keyword' | 'vector'
  /** vector / hybrid 为 RRF 融合分；keyword 为 entry.priority（裁切时优先去掉低值） */
  score: number
  /** vector 命中时：RRF 融合 vs 纯向量回退（刻度不可比） */
  scoreKind?: 'rrf' | 'vector_fallback'
}
export interface PromptBudgetTrimState {
  /** 恒定注入 lore（不可裁切） */
  constantLore: ConstantLoreItem[]
  /** 向量 / 关键词匹配 lore（可裁切，优先级最高） */
  matchedLore: TrimmableLoreEntry[]
  memoryItems: { turn: TurnRecord; score: number }[]
  knowledgeItems: KnowledgeHitItem[]
  historyMessages: ChatMessage[]
}
export interface PromptBudgetTrimResult {
  droppedLoreCount: number
  droppedMemoryCount: number
  droppedKnowledgeCount: number
}

type OrderedLoreXmlRow = {
  lorebookId: string
  lorebookName: string
  order: number
  /** 同 order 时恒定先于匹配 */
  sourceRank: 0 | 1
  id: string
  name: string
  content: string
}

function compareOrderedLoreXmlRows(a: OrderedLoreXmlRow, b: OrderedLoreXmlRow): number {
  if (a.order !== b.order) return a.order - b.order
  if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank
  return a.id.localeCompare(b.id)
}

/** 同书内按 entry.order 升序（越小越靠前）；恒定与匹配可交错 */
function loreItemsToXmlGroups(
  state: PromptBudgetTrimState,
  position?: LorebookEntryPosition,
): LorebookXmlGroup[] {
  const rows: OrderedLoreXmlRow[] = []
  for (const c of state.constantLore) {
    if (position && resolveEntryPosition(c.entry) !== position) continue
    const body = c.entry.content.trim()
    if (!body) continue
    rows.push({
      lorebookId: c.lorebookId,
      lorebookName: c.lorebookName.trim() || c.lorebookId,
      order: Number.isFinite(c.entry.order) ? c.entry.order : 0,
      sourceRank: 0,
      id: c.entry.id,
      name: c.entry.title.trim() || '未命名',
      content: body,
    })
  }
  for (const m of state.matchedLore) {
    if (position && resolveEntryPosition(m.entry) !== position) continue
    const body = m.entry.content.trim()
    if (!body) continue
    rows.push({
      lorebookId: m.lorebookId,
      lorebookName: m.lorebookName.trim() || m.lorebookId,
      order: Number.isFinite(m.entry.order) ? m.entry.order : 0,
      sourceRank: 1,
      id: m.entry.id,
      name: m.entry.title.trim() || '未命名',
      content: body,
    })
  }

  const byBook = new Map<
    string,
    { lorebookName: string; rows: OrderedLoreXmlRow[] }
  >()
  const bookOrder: string[] = []
  for (const row of rows) {
    let g = byBook.get(row.lorebookId)
    if (!g) {
      g = { lorebookName: row.lorebookName, rows: [] }
      byBook.set(row.lorebookId, g)
      bookOrder.push(row.lorebookId)
    }
    g.rows.push(row)
  }

  const groups: LorebookXmlGroup[] = []
  for (const id of bookOrder) {
    const g = byBook.get(id)!
    g.rows.sort(compareOrderedLoreXmlRows)
    groups.push({
      lorebookName: g.lorebookName,
      entries: g.rows.map((r) => ({ name: r.name, content: r.content })),
    })
  }
  return groups.filter((g) => g.entries.length > 0)
}

/** 按插入位置格式化 lore XML；省略 position 时合并 before+after（预算估算用） */
export function worldTextFromTrimState(
  state: PromptBudgetTrimState,
  position?: LorebookEntryPosition,
): string {
  return formatLoresInjectionXml(loreItemsToXmlGroups(state, position))
}

export function worldTextsFromTrimState(state: PromptBudgetTrimState): {
  worldBefore: string
  worldAfter: string
} {
  return {
    worldBefore: worldTextFromTrimState(state, 'before_char'),
    worldAfter: worldTextFromTrimState(state, 'after_char'),
  }
}

export function memoryTextFromTrimState(state: PromptBudgetTrimState): string {
  return formatMemoryXml(state.memoryItems)
}
export function knowledgeTextFromTrimState(
  state: PromptBudgetTrimState,
): string {
  return formatKnowledgeXml(
    state.knowledgeItems.map((i) => ({
      kbName: i.kbName,
      fileName: i.fileName,
      ordinal: i.ordinal,
      text: i.text,
    })),
  )
}
export function canTrimMatchedLore(
  state: PromptBudgetTrimState,
  minRetain: number,
): boolean {
  return state.matchedLore.length > minRetain
}
/** 去掉一条可裁切 lore（先 vector 低分，再 keyword 低 priority） */
export function trimOneMatchedLore(
  state: PromptBudgetTrimState,
  minRetain: number,
): boolean {
  if (!canTrimMatchedLore(state, minRetain)) return false
  let dropIdx = 0
  let worst = loreTrimSortKey(state.matchedLore[0]!)
  for (let i = 1; i < state.matchedLore.length; i++) {
    const key = loreTrimSortKey(state.matchedLore[i]!)
    if (compareLoreTrimKeys(key, worst) < 0) {
      worst = key
      dropIdx = i
    }
  }
  state.matchedLore.splice(dropIdx, 1)
  return true
}
function loreTrimSortKey(m: TrimmableLoreEntry): [number, number] {
  if (m.mode === 'vector') return [0, m.score]
  return [1, m.score]
}
/** 越小越先删 */
function compareLoreTrimKeys(a: [number, number], b: [number, number]): number {
  if (a[0] !== b[0]) return a[0] - b[0]
  return a[1] - b[1]
}
export function canTrimMemoryItem(
  state: PromptBudgetTrimState,
  minRetain: number,
): boolean {
  return state.memoryItems.length > minRetain
}
export function trimOneMemoryItem(
  state: PromptBudgetTrimState,
  minRetain: number,
): boolean {
  if (!canTrimMemoryItem(state, minRetain)) return false
  let dropIdx = 0
  let earliest = state.memoryItems[0]!.turn.turnOrdinal
  for (let i = 1; i < state.memoryItems.length; i++) {
    const ord = state.memoryItems[i]!.turn.turnOrdinal
    if (ord < earliest) {
      earliest = ord
      dropIdx = i
    }
  }
  state.memoryItems.splice(dropIdx, 1)
  return true
}
export function canTrimKnowledgeItem(
  state: PromptBudgetTrimState,
  minRetain: number,
): boolean {
  return state.knowledgeItems.length > minRetain
}
/** 去掉一条知识库命中（最低 score） */
export function trimOneKnowledgeItem(
  state: PromptBudgetTrimState,
  minRetain: number,
): boolean {
  if (!canTrimKnowledgeItem(state, minRetain)) return false
  let dropIdx = 0
  let lowest = state.knowledgeItems[0]!.score
  for (let i = 1; i < state.knowledgeItems.length; i++) {
    const score = state.knowledgeItems[i]!.score
    if (score < lowest) {
      lowest = score
      dropIdx = i
    }
  }
  state.knowledgeItems.splice(dropIdx, 1)
  return true
}
export function canTrimHistoryMessage(
  state: PromptBudgetTrimState,
  minRetain: number,
): boolean {
  return state.historyMessages.length > minRetain
}
/** 去掉 history 中最旧一条（user/assistant 链头部） */
export function trimOneHistoryMessage(
  state: PromptBudgetTrimState,
  minRetain: number,
): boolean {
  if (!canTrimHistoryMessage(state, minRetain)) return false
  state.historyMessages.shift()
  return true
}
function trimOneForSlot(
  state: PromptBudgetTrimState,
  slot: BudgetTrimSlot,
  settings: BudgetTrimSettings,
): boolean {
  switch (slot) {
    case 'knowledge':
      return trimOneKnowledgeItem(state, settings.minRetain.knowledge)
    case 'lore':
      return trimOneMatchedLore(state, settings.minRetain.lore)
    case 'memory':
      return trimOneMemoryItem(state, settings.minRetain.memory)
    case 'history':
      return trimOneHistoryMessage(state, settings.minRetain.history)
  }
}

/**
 * 同一轮按 trimOrder 轮询：从 cursor 起找第一个可删槽，删一条后 cursor 移到下一槽。
 * 触 minRetain 的槽跳过。返回删中的槽；无可删时 null（cursor 不变）。
 */
export function trimOneRoundRobin(
  state: PromptBudgetTrimState,
  settings: BudgetTrimSettings,
  cursor: { index: number },
): BudgetTrimSlot | null {
  const order = settings.trimOrder
  const n = order.length
  if (n === 0) return null
  const start = ((cursor.index % n) + n) % n
  for (let i = 0; i < n; i++) {
    const idx = (start + i) % n
    const slot = order[idx]!
    if (!trimOneForSlot(state, slot, settings)) continue
    cursor.index = (idx + 1) % n
    return slot
  }
  return null
}
/**
 * §14.4.1：组装一次 → PromptSlot 账本裁切并投影（不再二次 assemble）。
 * chat-assemble 在插件→宏→regex 之后调 `trimAssembledMessagesWithPromptSlots`；
 * 本函数保留给单测 / 仅 state 组装的路径。
 */
export function runPromptBudgetTrimLoop(opts: {
  maxTokens: number
  tokenModel?: string
  trimSettings: BudgetTrimSettings
  state: PromptBudgetTrimState
  assembleMessages: (state: PromptBudgetTrimState) => ChatMessage[]
}): {
  messages: ChatMessage[]
  estimatedTokens: number
  drops: PromptBudgetTrimResult
  /** 裁切前全量组装 token（未裁切时与 estimatedTokens 相同） */
  tokensBeforeTrim: number
  /** assembleMessages 调用次数（未超限或仅组装 1） */
  assemblePasses: number
} {
  const contentTokenCache = new Map<string, number>()
  const tokenOpt: TokenCountOptions = {
    model: opts.tokenModel,
    contentTokenCache,
  }
  const messages0 = opts.assembleMessages(opts.state)
  const tokens0 = countChatMessagesTokens(messages0, tokenOpt)
  const budget = Math.floor(opts.maxTokens)
  if (!Number.isFinite(budget) || budget <= 0 || tokens0 <= budget) {
    return {
      messages: messages0,
      estimatedTokens: tokens0,
      drops: {
        droppedLoreCount: 0,
        droppedMemoryCount: 0,
        droppedKnowledgeCount: 0,
      },
      tokensBeforeTrim: tokens0,
      assemblePasses: 1,
    }
  }

  const trimmed = trimAssembledMessagesWithPromptSlots({
    messages: messages0,
    state: opts.state,
    maxTokens: budget,
    trimSettings: opts.trimSettings,
    tokenModel: opts.tokenModel,
  })
  return {
    messages: trimmed.messages,
    estimatedTokens: trimmed.estimatedTokens,
    drops: trimmed.drops,
    tokensBeforeTrim: trimmed.tokensBeforeTrim,
    assemblePasses: 1,
  }
}
