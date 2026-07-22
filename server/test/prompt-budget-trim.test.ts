import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LorebookEntry } from '../src/lorebook-types.js'
import type { TurnRecord } from '../src/chat-storage.js'
import {
  BUDGET_TRIM_SETTINGS_DEFAULTS,
  type BudgetTrimSettings,
} from '../src/budget-trim-settings.js'
import {
  estimateTrimTokenDelta,
  runPromptBudgetTrimLoop,
  trimOneHistoryMessage,
  trimOneMatchedLore,
  trimOneMemoryItem,
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

function messagesFromState(s: PromptBudgetTrimState): ChatMessage[] {
  const parts: string[] = ['preset-fixed']
  for (const m of s.matchedLore) {
    parts.push(m.entry.content)
  }
  for (const m of s.memoryItems) {
    parts.push(m.turn.send.userText)
  }
  for (const h of s.historyMessages) {
    parts.push(h.content)
  }
  return [{ role: 'system', content: parts.join('\n') }]
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

describe('estimateTrimTokenDelta', () => {
  it('returns positive delta when lore entry removed', () => {
    const state = baseState()
    const snapshot = {
      worldText: 'before',
      memoryText: '',
      knowledgeText: '',
    }
    trimOneMatchedLore(state, 1)
    const delta = estimateTrimTokenDelta(state, 'lore', snapshot)
    assert.ok(delta >= 0)
  })
})

describe('runPromptBudgetTrimLoop', () => {
  it('drops matched lore before memory when over budget', () => {
    const state = baseState()
    state.matchedLore[0]!.entry.content = 'lore-chunk '.repeat(400)
    state.matchedLore[1]!.entry.content = 'lore-chunk '.repeat(20)
    state.memoryItems = [
      { turn: turn('m2', 2, 'small memory'), score: 0.9 },
    ]

    const result = runPromptBudgetTrimLoop({
      maxTokens: 150,
      trimSettings: DEFAULT_TRIM,
      state,
      assembleMessages: messagesFromState,
    })

    assert.equal(result.drops.droppedLoreCount, 1)
    assert.equal(result.drops.droppedMemoryCount, 0)
    assert.equal(state.matchedLore.length, 1)
    assert.equal(state.matchedLore[0]!.entry.id, 'l2')
    assert.ok(result.estimatedTokens <= 150)
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
    assert.ok(result.drops.droppedHistoryCount >= 1)
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
    const anchor = 'anchor '.repeat(2000)
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

    const assemble = (s: PromptBudgetTrimState): ChatMessage[] => [
      {
        role: 'system',
        content:
          anchor + s.matchedLore.map((m) => m.entry.content).join('\n'),
      },
    ]

    const count = (s: PromptBudgetTrimState) =>
      countChatMessagesTokens(assemble(s))

    const fullTokens = count(state)
    const oneLess = structuredClone(state)
    trimOneMatchedLore(oneLess, 0)
    const afterOneDrop = count(oneLess)
    assert.ok(fullTokens > afterOneDrop)
    const budget = afterOneDrop + Math.max(1, fullTokens - afterOneDrop - 1)

    const result = runPromptBudgetTrimLoop({
      maxTokens: budget,
      trimSettings: {
        ...DEFAULT_TRIM,
        minRetain: { lore: 0, memory: 0, history: 0 },
      },
      state,
      assembleMessages: assemble,
    })

    assert.equal(result.drops.droppedLoreCount, 1)
    assert.ok(result.estimatedTokens <= budget)
    assert.equal(state.matchedLore.length, 1)
    assert.equal(state.matchedLore[0]!.entry.id, 'l-small')
  })
})
