import type { ChatMessage } from './assemble-prompts.js'
import type { TurnRecord } from './chat-storage.js'
import type { LorebookEntry } from './lorebook-types.js'
import {
  type BudgetTrimSettings,
  type BudgetTrimSlot,
} from './budget-trim-settings.js'
import { countChatMessagesTokens, estimateTokens } from './token-count.js'
import { formatMemoryXml } from './turn-memory-xml.js'
import {
  formatLoresInjectionXml,
  mergeLorebookXmlGroups,
  type LorebookXmlGroup,
} from './prompt-xml.js'
import { formatKnowledgeXml } from './knowledge-xml.js'
import type { KnowledgeHitItem } from './knowledge-resolve.js'
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
  constantLoreGroups: LorebookXmlGroup[]
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
  droppedHistoryCount: number
}
export function worldTextFromTrimState(state: PromptBudgetTrimState): string {
  const matchedGroups = matchedLoreToXmlGroups(state.matchedLore)
  const merged = mergeLorebookXmlGroups(
    state.constantLoreGroups,
    matchedGroups,
  )
  return formatLoresInjectionXml(merged)
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
function matchedLoreToXmlGroups(
  matched: TrimmableLoreEntry[],
): LorebookXmlGroup[] {
  const byBook = new Map<string, LorebookXmlGroup>()
  for (const m of matched) {
    let g = byBook.get(m.lorebookId)
    if (!g) {
      g = { lorebookName: m.lorebookName.trim() || m.lorebookId, entries: [] }
      byBook.set(m.lorebookId, g)
    }
    const body = m.entry.content.trim()
    if (!body) continue
    g.entries.push({
      name: m.entry.title.trim() || '未命名',
      content: body,
    })
  }
  return [...byBook.values()].filter((g) => g.entries.length > 0)
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
function recordDrop(drops: PromptBudgetTrimResult, slot: BudgetTrimSlot): void {
  switch (slot) {
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
      drops.droppedHistoryCount += 1
      break
  }
}
/** 每 N 轮裁切用全量 assemble+tiktoken 校准一次（防止增量估算漂移） */
export const TRIM_TOKEN_REVERIFY_EVERY = 4
interface TrimTokenSnapshot {
  worldText: string
  memoryText: string
  knowledgeText: string
  removedHistory?: ChatMessage
}
/** 估算单次裁切减少的 token（world / memory / knowledge XML 差分 + history 单条） */
export function estimateTrimTokenDelta(
  state: PromptBudgetTrimState,
  slot: BudgetTrimSlot,
  snapshot: TrimTokenSnapshot,
  tokenModel?: string,
): number {
  const opt = { model: tokenModel }
  if (slot === 'lore') {
    const after = worldTextFromTrimState(state)
    return Math.max(
      0,
      estimateTokens(snapshot.worldText, opt) - estimateTokens(after, opt),
    )
  }
  if (slot === 'memory') {
    const after = memoryTextFromTrimState(state)
    return Math.max(
      0,
      estimateTokens(snapshot.memoryText, opt) - estimateTokens(after, opt),
    )
  }
  if (slot === 'knowledge') {
    const after = knowledgeTextFromTrimState(state)
    return Math.max(
      0,
      estimateTokens(snapshot.knowledgeText, opt) -
        estimateTokens(after, opt),
    )
  }
  if (slot === 'history' && snapshot.removedHistory) {
    return countChatMessagesTokens([snapshot.removedHistory], opt)
  }
  return 0
}
/**
 * §14.4 统一预算裁切：每删一条全量 assemble + tiktoken 校准；结束时一次 assemble。
 * 顺序与下限由 `BudgetTrimSettings` 决定。
 * 入口 `buildConversationOutboundMessages` 在裁切前对组装结果施加 outgoing regex（与最终出站一致）。
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
} {
  const drops: PromptBudgetTrimResult = {
    droppedLoreCount: 0,
    droppedMemoryCount: 0,
    droppedKnowledgeCount: 0,
    droppedHistoryCount: 0,
  }
  const count = (msgs: ChatMessage[]) =>
    countChatMessagesTokens(msgs, { model: opts.tokenModel })
  let messages = opts.assembleMessages(opts.state)
  let tokens = count(messages)
  const tokensBeforeTrim = tokens
  const budget = Math.floor(opts.maxTokens)
  if (!Number.isFinite(budget) || budget <= 0) {
    return { messages, estimatedTokens: tokens, drops, tokensBeforeTrim }
  }
  const order = opts.trimSettings.trimOrder
  const MAX_ROUNDS = 512
  // §14.4.1：每删一条即全量 assemble + tiktoken 重算，避免增量 XML 差分漂移导致过度裁切
  for (let round = 0; round < MAX_ROUNDS; round++) {
    messages = opts.assembleMessages(opts.state)
    tokens = count(messages)
    if (tokens <= budget) break
    let trimmed = false
    for (const slot of order) {
      if (!trimOneForSlot(opts.state, slot, opts.trimSettings)) continue
      recordDrop(drops, slot)
      trimmed = true
      break
    }
    if (!trimmed) break
  }
  messages = opts.assembleMessages(opts.state)
  tokens = count(messages)
  return { messages, estimatedTokens: tokens, drops, tokensBeforeTrim }
}
