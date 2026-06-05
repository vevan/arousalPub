import type { ChatMessage } from './assemble-prompts.js'

import type { TurnRecord } from './chat-storage.js'

import type { LorebookEntry } from './lorebook-types.js'

import {

  type BudgetTrimSettings,

  type BudgetTrimSlot,

} from './budget-trim-settings.js'

import { countChatMessagesTokens } from './token-count.js'

import { formatMemoryXml } from './turn-memory-xml.js'

import {

  formatLoresInjectionXml,

  mergeLorebookXmlGroups,

  type LorebookXmlGroup,

} from './prompt-xml.js'



/** 可裁切资料库条目（keyword / vector；不含 constant） */

export interface TrimmableLoreEntry {

  lorebookId: string

  lorebookName: string

  entry: LorebookEntry

  mode: 'keyword' | 'vector'

  /** vector 为相似度；keyword 为 entry.priority（裁切时优先去掉低值） */

  score: number

}



export interface PromptBudgetTrimState {

  /** 恒定注入 lore（不可裁切） */

  constantLoreGroups: LorebookXmlGroup[]

  /** 向量 / 关键词匹配 lore（可裁切，优先级最高） */

  matchedLore: TrimmableLoreEntry[]

  memoryItems: { turn: TurnRecord; score: number }[]

  historyMessages: ChatMessage[]

}



export interface PromptBudgetTrimResult {

  droppedLoreCount: number

  droppedMemoryCount: number

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

  let lowest = state.memoryItems[0]!.score

  for (let i = 1; i < state.memoryItems.length; i++) {

    if (state.memoryItems[i]!.score < lowest) {

      lowest = state.memoryItems[i]!.score

      dropIdx = i

    }

  }

  state.memoryItems.splice(dropIdx, 1)

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



/**

 * §14.4 统一预算裁切：每删一条可裁项后重算 token，直到 ≤ maxTokens 或无可删项。

 * 顺序与下限由 `BudgetTrimSettings` 决定。

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

} {

  const drops: PromptBudgetTrimResult = {

    droppedLoreCount: 0,

    droppedMemoryCount: 0,

    droppedHistoryCount: 0,

  }

  const count = (msgs: ChatMessage[]) =>

    countChatMessagesTokens(msgs, { model: opts.tokenModel })



  let messages = opts.assembleMessages(opts.state)

  let tokens = count(messages)

  const budget = Math.floor(opts.maxTokens)

  if (!Number.isFinite(budget) || budget <= 0) {

    return { messages, estimatedTokens: tokens, drops }

  }



  const order = opts.trimSettings.trimOrder

  const MAX_ROUNDS = 512

  for (let round = 0; round < MAX_ROUNDS && tokens > budget; round++) {

    let trimmed = false

    for (const slot of order) {

      if (trimOneForSlot(opts.state, slot, opts.trimSettings)) {

        recordDrop(drops, slot)

        trimmed = true

        break

      }

    }

    if (!trimmed) break

    messages = opts.assembleMessages(opts.state)

    tokens = count(messages)

  }



  return { messages, estimatedTokens: tokens, drops }

}


