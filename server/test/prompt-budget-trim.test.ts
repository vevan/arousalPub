import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LorebookEntry } from '../src/lorebook-types.js'
import type { TurnRecord } from '../src/chat-storage.js'
import {
  BUDGET_TRIM_SETTINGS_DEFAULTS,
  type BudgetTrimSettings,
} from '../src/budget-trim-settings.js'
import {
  knowledgeTextFromTrimState,
  memoryTextFromTrimState,
  runPromptBudgetTrimLoop,
  trimOneHistoryMessage,
  trimOneMatchedLore,
  trimOneMemoryItem,
  trimOneRoundRobin,
  worldTextsFromTrimState,
  type PromptBudgetTrimState,
} from '../src/prompt-budget-trim.js'
import type { ChatMessage } from '../src/assemble-prompts.js'
import { countChatMessagesTokens } from '../src/token-count.js'

function loreEntry(id: string, priority: number, content: string): LorebookEntry {
  return {
    id,
    groupId: 'g1',
    title: id,
    content,
    keys: ['key'],
    enabled: true,
    order: 0,
    priority,
    constant: false,
    triggerMode: 'keyword',
    createdAt: '',
    updatedAt: '',
  }
}

function turn(id: string, ordinal: number, text: string): TurnRecord {
  return {
    turnId: id,
    turnOrdinal: ordinal,
    send: { userText: text },
    receives: [{ id: `r-${id}`, content: 'ok' }],
    activeReceiveIndex: 0,
    plugins: [],
  }
}

function baseState(): PromptBudgetTrimState {
  return {
    constantLore: [
      {
        lorebookId: 'lb1',
        lorebookName: 'World',
        entry: loreEntry('constant', 100, 'must keep'),
      },
    ],
    matchedLore: [
      {
        lorebookId: 'lb1',
        lorebookName: 'World',
        entry: loreEntry('l1', 1, 'low priority lore'),
        mode: 'keyword',
        score: 1,
      },
      {
        lorebookId: 'lb1',
        lorebookName: 'World',
        entry: loreEntry('l2', 9, 'high priority lore'),
        mode: 'keyword',
        score: 9,
      },
    ],
    memoryItems: [
      { turn: turn('m1', 1, 'mem low'), score: 0.2 },
      { turn: turn('m2', 2, 'mem high'), score: 0.9 },
    ],
    knowledgeItems: [],
    historyMessages: [
      { role: 'user', content: 'old user' },
      { role: 'assistant', content: 'old assistant' },
      { role: 'user', content: 'new user' },
    ],
  }
}

/** 与账本槽位一致：world/memory/knowledge 各成一条，history 按条追加 */
function messagesFromState(s: PromptBudgetTrimState): ChatMessage[] {
  const { worldBefore, worldAfter } = worldTextsFromTrimState(s)
  const memory = memoryTextFromTrimState(s)
  const knowledge = knowledgeTextFromTrimState(s)
  const msgs: ChatMessage[] = [{ role: 'system', content: 'preset-fixed' }]
  if (worldBefore) msgs.push({ role: 'system', content: worldBefore })
  if (worldAfter) msgs.push({ role: 'system', content: worldAfter })
  if (memory) msgs.push({ role: 'system', content: memory })
  if (knowledge) msgs.push({ role: 'system', content: knowledge })
  for (const h of s.historyMessages) {
    msgs.push({ role: h.role, content: h.content })
  }
  return msgs
}

const DEFAULT_TRIM: BudgetTrimSettings = BUDGET_TRIM_SETTINGS_DEFAULTS

describe('worldTextsFromTrimState', () => {
  it('splits before_char and after_char; missing position defaults to after_char', () => {
    const state: PromptBudgetTrimState = {
      constantLore: [
        {
          lorebookId: 'lb1',
          lorebookName: 'World',
          entry: {
            ...loreEntry('c-before', 10, 'CONST-BEFORE'),
            position: 'before_char',
          },
        },
        {
          lorebookId: 'lb1',
          lorebookName: 'World',
          entry: {
            ...loreEntry('c-after', 10, 'CONST-AFTER'),
            position: 'after_char',
          },
        },
      ],
      matchedLore: [
        {
          lorebookId: 'lb1',
          lorebookName: 'World',
          entry: {
            ...loreEntry('m-before', 5, 'MATCH-BEFORE'),
            position: 'before_char',
          },
          mode: 'keyword',
          score: 5,
        },
        {
          lorebookId: 'lb1',
          lorebookName: 'World',
          entry: loreEntry('m-default', 5, 'MATCH-DEFAULT'),
          mode: 'keyword',
          score: 5,
        },
      ],
      memoryItems: [],
      knowledgeItems: [],
      historyMessages: [],
    }
    const { worldBefore, worldAfter } = worldTextsFromTrimState(state)
    assert.ok(worldBefore.includes('CONST-BEFORE'))
    assert.ok(worldBefore.includes('MATCH-BEFORE'))
    assert.equal(worldBefore.includes('CONST-AFTER'), false)
    assert.equal(worldBefore.includes('MATCH-DEFAULT'), false)
    assert.ok(worldAfter.includes('CONST-AFTER'))
    assert.ok(worldAfter.includes('MATCH-DEFAULT'))
    assert.equal(worldAfter.includes('CONST-BEFORE'), false)
    assert.equal(worldAfter.includes('MATCH-BEFORE'), false)
  })

  it('orders injected lore by entry.order ascending (smaller first)', () => {
    const state: PromptBudgetTrimState = {
      constantLore: [
        {
          lorebookId: 'lb1',
          lorebookName: 'World',
          entry: {
            ...loreEntry('late-const', 1, 'LATE-CONST'),
            order: 30,
            position: 'after_char',
          },
        },
      ],
      matchedLore: [
        {
          lorebookId: 'lb1',
          lorebookName: 'World',
          entry: {
            ...loreEntry('early-match', 1, 'EARLY-MATCH'),
            order: 10,
            position: 'after_char',
          },
          mode: 'keyword',
          score: 1,
        },
        {
          lorebookId: 'lb1',
          lorebookName: 'World',
          entry: {
            ...loreEntry('mid-match', 1, 'MID-MATCH'),
            order: 20,
            position: 'after_char',
          },
          mode: 'keyword',
          score: 1,
        },
      ],
      memoryItems: [],
      knowledgeItems: [],
      historyMessages: [],
    }
    const { worldAfter } = worldTextsFromTrimState(state)
    const early = worldAfter.indexOf('EARLY-MATCH')
    const mid = worldAfter.indexOf('MID-MATCH')
    const late = worldAfter.indexOf('LATE-CONST')
    assert.ok(early >= 0 && mid >= 0 && late >= 0)
    assert.ok(early < mid)
    assert.ok(mid < late)
  })
})

describe('trimOneMatchedLore', () => {
  it('drops lowest keyword priority first', () => {
    const state = baseState()
    assert.equal(trimOneMatchedLore(state, 1), true)
    assert.equal(state.matchedLore.length, 1)
    assert.equal(state.matchedLore[0]!.entry.id, 'l2')
  })

  it('does not drop when only one entry left', () => {
    const state = baseState()
    state.matchedLore = [state.matchedLore[1]!]
    assert.equal(trimOneMatchedLore(state, 1), false)
    assert.equal(state.matchedLore.length, 1)
  })
})

describe('trimOneMemoryItem', () => {
  it('drops earliest turnOrdinal first', () => {
    const state = baseState()
    assert.equal(trimOneMemoryItem(state, 1), true)
    assert.equal(state.memoryItems.length, 1)
    assert.equal(state.memoryItems[0]!.turn.turnId, 'm2')
  })

  it('does not drop when only one item left', () => {
    const state = baseState()
    state.memoryItems = [state.memoryItems[1]!]
    assert.equal(trimOneMemoryItem(state, 1), false)
    assert.equal(state.memoryItems.length, 1)
  })
})

describe('trimOneHistoryMessage', () => {
  it('drops oldest message first', () => {
    const state = baseState()
    assert.equal(trimOneHistoryMessage(state, 1), true)
    assert.equal(state.historyMessages[0]!.content, 'old assistant')
  })

  it('does not drop when only one message left', () => {
    const state = baseState()
    state.historyMessages = [{ role: 'user', content: 'only' }]
    assert.equal(trimOneHistoryMessage(state, 1), false)
    assert.equal(state.historyMessages.length, 1)
  })
})

describe('trimOneRoundRobin', () => {
  it('polls lore → memory → history → lore (not drain lore first)', () => {
    const state = baseState()
    state.knowledgeItems = []
    const cursor = { index: 0 }
    const settings: BudgetTrimSettings = {
      trimOrder: ['knowledge', 'lore', 'memory', 'history'],
      minRetain: { knowledge: 0, lore: 0, memory: 0, history: 0 },
    }
    assert.equal(trimOneRoundRobin(state, settings, cursor), 'lore')
    assert.equal(trimOneRoundRobin(state, settings, cursor), 'memory')
    assert.equal(trimOneRoundRobin(state, settings, cursor), 'history')
    assert.equal(trimOneRoundRobin(state, settings, cursor), 'lore')
  })

  it('skips slots at minRetain and continues the round', () => {
    const state = baseState()
    state.knowledgeItems = []
    state.matchedLore = [state.matchedLore[0]!]
    const cursor = { index: 0 }
    const settings: BudgetTrimSettings = {
      trimOrder: ['knowledge', 'lore', 'memory', 'history'],
      minRetain: { knowledge: 0, lore: 1, memory: 1, history: 1 },
    }
    // lore 已触下限 → 跳到 memory
    assert.equal(trimOneRoundRobin(state, settings, cursor), 'memory')
    assert.equal(trimOneRoundRobin(state, settings, cursor), 'history')
  })
})

describe('runPromptBudgetTrimLoop', () => {
  it('under budget returns after a single assemble pass', () => {
    const state = baseState()
    const result = runPromptBudgetTrimLoop({
      maxTokens: 100_000,
      trimSettings: DEFAULT_TRIM,
      state,
      assembleMessages: messagesFromState,
    })
    assert.equal(result.drops.droppedLoreCount, 0)
    assert.equal(result.assemblePasses, 1)
    assert.equal(result.estimatedTokens, result.tokensBeforeTrim)
  })

  it('over budget trims on slot ledger then projects (single assemble)', () => {
    const state = baseState()
    state.matchedLore[0]!.entry.content = 'lore-chunk '.repeat(400)
    state.matchedLore[1]!.entry.content = 'lore-chunk '.repeat(20)
    state.memoryItems = [
      { turn: turn('m2', 2, 'small memory'), score: 0.9 },
    ]
    const full = countChatMessagesTokens(messagesFromState(state))
    const afterOneLore = structuredClone(state)
    trimOneMatchedLore(afterOneLore, 0)
    const afterOne = countChatMessagesTokens(messagesFromState(afterOneLore))
    const budget = afterOne + Math.max(1, Math.floor((full - afterOne) / 2))

    const result = runPromptBudgetTrimLoop({
      maxTokens: budget,
      trimSettings: DEFAULT_TRIM,
      state,
      assembleMessages: messagesFromState,
    })

    const drops =
      result.drops.droppedLoreCount +
      result.drops.droppedMemoryCount +
      result.drops.droppedKnowledgeCount
    assert.ok(drops >= 1)
    assert.equal(result.assemblePasses, 1)
    assert.ok(result.estimatedTokens <= budget)
    assert.equal(
      result.estimatedTokens,
      countChatMessagesTokens(result.messages),
    )
  })

  it('many lore drops still use only one assemble pass', () => {
    const state = baseState()
    state.constantLore = []
    state.memoryItems = []
    state.historyMessages = []
    state.matchedLore = []
    for (let i = 0; i < 8; i++) {
      state.matchedLore.push({
        lorebookId: 'lb1',
        lorebookName: 'World',
        entry: loreEntry(`l${i}`, i + 1, `lore-${i} `.repeat(80)),
        mode: 'keyword',
        score: i + 1,
      })
    }
    const full = countChatMessagesTokens(messagesFromState(state))
    const onlyTwo = structuredClone(state)
    while (onlyTwo.matchedLore.length > 2) {
      trimOneMatchedLore(onlyTwo, 0)
    }
    const budget = countChatMessagesTokens(messagesFromState(onlyTwo)) + 5

    const result = runPromptBudgetTrimLoop({
      maxTokens: budget,
      trimSettings: {
        ...DEFAULT_TRIM,
        minRetain: { lore: 0, memory: 0, history: 0, knowledge: 0 },
      },
      state,
      assembleMessages: messagesFromState,
    })
    assert.ok(result.drops.droppedLoreCount >= 2)
    assert.ok(full > budget)
    assert.equal(result.assemblePasses, 1)
    assert.ok(result.estimatedTokens <= budget)
  })

  it('drops matched lore before memory when over budget', () => {
    const state = baseState()
    state.matchedLore[0]!.entry.content = 'lore-chunk '.repeat(400)
    state.matchedLore[1]!.entry.content = 'lore-chunk '.repeat(20)
    state.memoryItems = [
      { turn: turn('m2', 2, 'small memory'), score: 0.9 },
    ]
    const afterOneLore = structuredClone(state)
    trimOneMatchedLore(afterOneLore, 0)
    const budget =
      countChatMessagesTokens(messagesFromState(afterOneLore)) + 10

    const result = runPromptBudgetTrimLoop({
      maxTokens: budget,
      trimSettings: DEFAULT_TRIM,
      state,
      assembleMessages: messagesFromState,
    })

    assert.equal(result.drops.droppedLoreCount, 1)
    assert.equal(result.drops.droppedMemoryCount, 0)
    assert.equal(state.matchedLore.length, 1)
    assert.equal(state.matchedLore[0]!.entry.id, 'l2')
    assert.ok(result.estimatedTokens <= budget)
  })

  it('skips last memory item and trims history instead', () => {
    const state = baseState()
    state.matchedLore = []
    state.memoryItems = [
      { turn: turn('m1', 1, 'memory-chunk '.repeat(400)), score: 0.9 },
    ]
    state.historyMessages = [
      { role: 'user', content: 'hist '.repeat(200) },
      { role: 'assistant', content: 'hist '.repeat(200) },
      { role: 'user', content: 'hist '.repeat(200) },
    ]

    const result = runPromptBudgetTrimLoop({
      maxTokens: 120,
      trimSettings: DEFAULT_TRIM,
      state,
      assembleMessages: messagesFromState,
    })

    assert.equal(result.drops.droppedMemoryCount, 0)
    assert.equal(state.memoryItems.length, 1)
    assert.ok(state.historyMessages.length < 3)
  })

  it('drops memory after lore exhausted', () => {
    const state = baseState()
    state.matchedLore = []
    for (const m of state.memoryItems) {
      m.turn.send.userText = 'memory-chunk '.repeat(400)
    }

    const result = runPromptBudgetTrimLoop({
      maxTokens: 80,
      trimSettings: DEFAULT_TRIM,
      state,
      assembleMessages: messagesFromState,
    })

    assert.equal(result.drops.droppedLoreCount, 0)
    assert.ok(result.drops.droppedMemoryCount >= 1)
    assert.equal(state.memoryItems.length, 1)
  })

  it('stops after minimal trims when full recount shows under budget', () => {
    const state = baseState()
    state.constantLore = []
    state.matchedLore = [
      {
        lorebookId: 'lb1',
        lorebookName: 'World',
        entry: loreEntry('l-big', 1, 'lore-chunk '.repeat(200)),
        mode: 'keyword',
        score: 1,
      },
      {
        lorebookId: 'lb1',
        lorebookName: 'World',
        entry: loreEntry('l-small', 9, 'tiny'),
        mode: 'keyword',
        score: 9,
      },
    ]
    state.memoryItems = []
    state.historyMessages = []

    const fullTokens = countChatMessagesTokens(messagesFromState(state))
    const oneLess = structuredClone(state)
    trimOneMatchedLore(oneLess, 0)
    const afterOneDrop = countChatMessagesTokens(messagesFromState(oneLess))
    assert.ok(fullTokens > afterOneDrop)
    const budget = afterOneDrop + Math.max(1, fullTokens - afterOneDrop - 1)

    const result = runPromptBudgetTrimLoop({
      maxTokens: budget,
      trimSettings: {
        ...DEFAULT_TRIM,
        minRetain: { lore: 0, memory: 0, history: 0, knowledge: 0 },
      },
      state,
      assembleMessages: messagesFromState,
    })

    assert.equal(result.drops.droppedLoreCount, 1)
    assert.equal(result.assemblePasses, 1)
    assert.ok(result.estimatedTokens <= budget)
    assert.equal(state.matchedLore.length, 1)
    assert.equal(state.matchedLore[0]!.entry.id, 'l-small')
  })

  it('slight overage stays within one drop of the minimum', () => {
    const state = baseState()
    state.constantLore = []
    state.memoryItems = []
    state.knowledgeItems = []
    state.historyMessages = []
    state.matchedLore = []
    for (let i = 0; i < 12; i++) {
      state.matchedLore.push({
        lorebookId: 'lb1',
        lorebookName: 'World',
        entry: loreEntry(`l${i}`, i + 1, `lore-body-${i} ${'x '.repeat(40)}`),
        mode: 'keyword',
        score: i + 1,
      })
    }
    const full = countChatMessagesTokens(messagesFromState(state))
    const one = structuredClone(state)
    trimOneMatchedLore(one, 0)
    const per = full - countChatMessagesTokens(messagesFromState(one))
    const budget = full - per - 5
    const probe = structuredClone(state)
    let minimal = 0
    while (countChatMessagesTokens(messagesFromState(probe)) > budget) {
      assert.equal(trimOneMatchedLore(probe, 0), true)
      minimal += 1
    }

    const result = runPromptBudgetTrimLoop({
      maxTokens: budget,
      trimSettings: {
        ...DEFAULT_TRIM,
        minRetain: { knowledge: 0, lore: 0, memory: 0, history: 0 },
      },
      state,
      assembleMessages: messagesFromState,
    })

    assert.ok(result.estimatedTokens <= budget)
    assert.equal(result.drops.droppedLoreCount, minimal)
    assert.equal(result.assemblePasses, 1)
  })

  it('treats lore absent from assembled messages as zero savings', () => {
    const state = baseState()
    state.constantLore = []
    state.memoryItems = []
    state.knowledgeItems = []
    state.matchedLore = []
    for (let i = 0; i < 4; i++) {
      state.matchedLore.push({
        lorebookId: 'lb1',
        lorebookName: 'World',
        entry: loreEntry(`l${i}`, i + 1, 'WORLD '.repeat(1500)),
        mode: 'keyword',
        score: i + 1,
      })
    }
    state.historyMessages = []
    for (let i = 0; i < 10; i++) {
      state.historyMessages.push({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: 'hist '.repeat(80),
      })
    }
    const assemble = (s: PromptBudgetTrimState): ChatMessage[] => {
      const msgs: ChatMessage[] = [{ role: 'system', content: 'preset' }]
      for (const h of s.historyMessages) {
        msgs.push({ role: h.role, content: h.content })
      }
      return msgs
    }
    const budget = 400
    assert.ok(countChatMessagesTokens(assemble(state)) > budget)

    const result = runPromptBudgetTrimLoop({
      maxTokens: budget,
      trimSettings: {
        ...DEFAULT_TRIM,
        trimOrder: ['lore', 'history', 'memory', 'knowledge'],
        minRetain: { knowledge: 0, lore: 0, memory: 0, history: 0 },
      },
      state,
      assembleMessages: assemble,
    })

    assert.ok(result.estimatedTokens <= budget)
    assert.ok(result.estimatedTokens > 8)
    assert.ok(state.historyMessages.length > 0)
    assert.ok(state.historyMessages.length < 10)
    assert.equal(result.assemblePasses, 1)
  })
})
