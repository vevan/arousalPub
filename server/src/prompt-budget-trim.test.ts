import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LorebookEntry } from './lorebook-types.js'
import type { TurnRecord } from './chat-storage.js'
import {
  BUDGET_TRIM_SETTINGS_DEFAULTS,
  type BudgetTrimSettings,
} from './budget-trim-settings.js'
import {
  estimateTrimTokenDelta,
  runPromptBudgetTrimLoop,
  trimOneHistoryMessage,
  trimOneMatchedLore,
  trimOneMemoryItem,
  type PromptBudgetTrimState,
} from './prompt-budget-trim.js'
import type { ChatMessage } from './assemble-prompts.js'

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
    constantLoreGroups: [
      {
        lorebookName: 'World',
        entries: [{ name: 'constant', content: 'must keep' }],
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
  it('drops lowest score first', () => {
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
})
