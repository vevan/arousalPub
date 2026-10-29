import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { LorebookEntry } from '../src/lorebook-types.js'
import type { TurnRecord } from '../src/chat-storage.js'
import { BUDGET_TRIM_SETTINGS_DEFAULTS } from '../src/budget-trim-settings.js'
import {
  assertSlotLedgerMatchesProjection,
  buildHistoryAtomicSlots,
  buildKnowledgeMergeSlot,
  buildLoreMergeSlot,
  buildMemoryMergeSlot,
  mergeSlotContent,
  projectPromptSlotsToMessages,
  runPromptSlotBudgetTrim,
  slotsFromAssembledMessages,
  stripEmptyLorebookElements,
  syncTrimStateFromTrimmableSlots,
  totalPromptSlotTokens,
  type PromptSlot,
} from '../src/prompt-slots.js'
import type { PromptBudgetTrimState } from '../src/prompt-budget-trim.js'
import { countChatMessagesTokens } from '../src/token-count.js'
import { formatLoresXmlGroupedBlock } from '../src/prompt-xml.js'

function loreEntry(id: string, priority: number, content: string): LorebookEntry {
  return {
    id,
    groupId: 'g1',
    title: id,
    content,
    keys: ['k'],
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

describe('prompt-slots merge wrap', () => {
  it('memory parts are pre-wrapped turn blocks under <memory>', () => {
    const slot = buildMemoryMergeSlot([
      { turn: turn('a', 1, 'hello'), score: 0.5 },
      { turn: turn('b', 2, 'world'), score: 0.9 },
    ])
    assert.ok(slot)
    assert.equal(slot!.prefix, '<memory>\n')
    assert.equal(slot!.parts.length, 2)
    assert.ok(slot!.parts[0]!.body.includes('<turn'))
    assert.ok(mergeSlotContent(slot!).startsWith('<memory>'))
    assert.ok(mergeSlotContent(slot!).endsWith('</memory>'))
  })

  it('lore parts are <lore> lines under <lores>', () => {
    const slot = buildLoreMergeSlot(
      [],
      [
        {
          lorebookId: 'lb',
          lorebookName: 'W',
          entry: loreEntry('e1', 1, 'alpha'),
          mode: 'keyword',
          score: 1,
        },
      ],
      'after_char',
    )
    assert.ok(slot)
    assert.ok(slot!.parts[0]!.body.includes('<lore'))
    assert.ok(mergeSlotContent(slot!).includes('<lores>'))
  })

  it('ledger matches projected messages tokens', () => {
    const slots: PromptSlot[] = []
    const mem = buildMemoryMergeSlot([
      { turn: turn('a', 1, 'mem '.repeat(20)), score: 1 },
    ])
    if (mem) slots.push(mem)
    slots.push(...buildHistoryAtomicSlots([
      { role: 'user', content: 'hi '.repeat(30), turnOrdinal: 1 },
      { role: 'assistant', content: 'yo '.repeat(30), turnOrdinal: 1 },
    ]))
    const { ledger, projected } = assertSlotLedgerMatchesProjection(slots)
    assert.equal(ledger, projected)
  })
})

describe('runPromptSlotBudgetTrim', () => {
  it('drops memory parts until under budget without re-project mid-loop', () => {
    const items = []
    for (let i = 0; i < 6; i++) {
      items.push({
        turn: turn(`m${i}`, i, `memory-chunk-${i} `.repeat(40)),
        score: 0.5,
      })
    }
    const mem = buildMemoryMergeSlot(items)!
    const slots: PromptSlot[] = [mem]
    const full = totalPromptSlotTokens(slots)
    const budget = Math.floor(full * 0.45)
    const result = runPromptSlotBudgetTrim({
      slots,
      maxTokens: budget,
      trimSettings: {
        ...BUDGET_TRIM_SETTINGS_DEFAULTS,
        trimOrder: ['memory', 'lore', 'knowledge', 'history'],
        minRetain: { knowledge: 0, lore: 0, memory: 0, history: 0 },
      },
    })
    assert.ok(result.estimatedTokens <= budget)
    assert.ok(result.drops.droppedMemoryCount >= 1)
    assert.ok(mem.parts.length < 6)
    const msgs = projectPromptSlotsToMessages(slots)
    assert.equal(
      countChatMessagesTokens(msgs),
      totalPromptSlotTokens(slots),
    )
  })
})

describe('syncTrimStateFromTrimmableSlots', () => {
  it('writes remaining lore/memory/history back to trim state', () => {
    const state: PromptBudgetTrimState = {
      constantLore: [],
      matchedLore: [
        {
          lorebookId: 'lb',
          lorebookName: 'W',
          entry: loreEntry('keep', 9, 'keep-me'),
          mode: 'keyword',
          score: 9,
        },
        {
          lorebookId: 'lb',
          lorebookName: 'W',
          entry: loreEntry('drop', 1, 'drop-me'),
          mode: 'keyword',
          score: 1,
        },
      ],
      memoryItems: [
        { turn: turn('m1', 1, 'a'), score: 0.5 },
        { turn: turn('m2', 2, 'b'), score: 0.5 },
      ],
      knowledgeItems: [],
      historyMessages: [
        { role: 'user', content: 'u1', turnOrdinal: 1 },
        { role: 'assistant', content: 'a1', turnOrdinal: 1 },
      ],
    }
    const slots = [
      buildLoreMergeSlot([], state.matchedLore, 'after_char')!,
      buildMemoryMergeSlot(state.memoryItems)!,
      ...buildHistoryAtomicSlots(state.historyMessages),
    ]
    // drop low-priority lore part + oldest history 槽
    const lore = slots[0]!
    if (lore.kind === 'lore') {
      lore.parts = lore.parts.filter((p) => p.id === 'match:keep')
    }
    const hi = slots.findIndex((s) => s.kind === 'history')
    assert.ok(hi >= 0)
    slots.splice(hi, 1)

    syncTrimStateFromTrimmableSlots(state, slots)
    assert.equal(state.matchedLore.length, 1)
    assert.equal(state.matchedLore[0]!.entry.id, 'keep')
    assert.equal(state.historyMessages.length, 1)
    assert.equal(state.historyMessages[0]!.role, 'assistant')
  })
})

describe('buildKnowledgeMergeSlot', () => {
  it('wraps chunks under <knowledge>', () => {
    const slot = buildKnowledgeMergeSlot([
      {
        kbId: 'k1',
        kbName: 'KB',
        fileId: 'f1',
        fileName: 'doc.txt',
        chunkId: 'c1',
        ordinal: 0,
        text: 'chunk body',
        score: 0.2,
      },
    ])
    assert.ok(slot)
    assert.ok(mergeSlotContent(slot!).includes('<knowledge>'))
    assert.ok(mergeSlotContent(slot!).includes('chunk body'))
  })
})

describe('slotsFromAssembledMessages lorebook grouping', () => {
  it('slices multi-book XML by <lore> not whole <lorebook>', () => {
    const xml = formatLoresXmlGroupedBlock([
      {
        lorebookName: '设定',
        entries: [
          { name: '世界', content: 'WORLD '.repeat(80) },
          { name: '角色', content: 'CHAR '.repeat(80) },
        ],
      },
      {
        lorebookName: '摘要',
        entries: [{ name: 'MEMO-1', content: 'SUM '.repeat(80) }],
      },
    ])
    assert.ok(xml.includes('<lorebook'))
    const state: PromptBudgetTrimState = {
      constantLore: [],
      matchedLore: [
        {
          lorebookId: 'lb1',
          lorebookName: '设定',
          entry: loreEntry('world', 1, 'WORLD '.repeat(80)),
          mode: 'keyword',
          score: 1,
        },
        {
          lorebookId: 'lb1',
          lorebookName: '设定',
          entry: { ...loreEntry('char', 5, 'CHAR '.repeat(80)), title: '角色' },
          mode: 'keyword',
          score: 5,
        },
        {
          lorebookId: 'lb2',
          lorebookName: '摘要',
          entry: { ...loreEntry('memo', 9, 'SUM '.repeat(80)), title: 'MEMO-1' },
          mode: 'keyword',
          score: 9,
        },
      ],
      memoryItems: [],
      knowledgeItems: [],
      historyMessages: [],
    }
    // title on world entry
    state.matchedLore[0]!.entry.title = '世界'

    const slots = slotsFromAssembledMessages(
      [{ role: 'system', content: xml }],
      state,
    )
    assert.equal(slots.length, 1)
    const lore = slots[0]!
    assert.equal(lore.kind, 'lore')
    if (lore.kind !== 'lore') return
    const trimmable = lore.parts.filter((p) => p.trimmable)
    const glue = lore.parts.filter((p) => p.id.startsWith('glue:'))
    assert.equal(trimmable.length, 3)
    assert.ok(glue.length >= 1)
    assert.equal(mergeSlotContent(lore), xml)

    const full = totalPromptSlotTokens(slots)
    const result = runPromptSlotBudgetTrim({
      slots,
      maxTokens: Math.floor(full * 0.55),
      trimSettings: {
        ...BUDGET_TRIM_SETTINGS_DEFAULTS,
        trimOrder: ['lore', 'memory', 'knowledge', 'history'],
        minRetain: { knowledge: 0, lore: 0, memory: 0, history: 0 },
      },
    })
    assert.ok(result.drops.droppedLoreCount >= 1)
    assert.ok(result.drops.droppedLoreCount < 3)
    const left = lore.parts.filter((p) => p.trimmable)
    assert.ok(left.length >= 1)
    assert.ok(left.every((p) => p.body.includes('<lore')))
    assert.ok(!left.some((p) => p.body.includes('<lorebook')))
  })

  it('malformed lores XML stays non-trimmable (no state rebuild)', () => {
    const state: PromptBudgetTrimState = {
      constantLore: [],
      matchedLore: [
        {
          lorebookId: 'lb',
          lorebookName: 'W',
          entry: loreEntry('e1', 1, 'x '.repeat(200)),
          mode: 'keyword',
          score: 1,
        },
      ],
      memoryItems: [],
      knowledgeItems: [],
      historyMessages: [],
    }
    const slots = slotsFromAssembledMessages(
      [{ role: 'system', content: '<lores>broken without close' }],
      state,
    )
    assert.equal(slots.length, 1)
    assert.equal(slots[0]!.kind, 'prompt')
    if (slots[0]!.kind === 'prompt') {
      assert.equal(slots[0]!.trimmable, false)
    }
    assert.equal(state.matchedLore.length, 1)
  })

  it('strips empty lorebook shells on project after dropping all lores in a book', () => {
    const xml = formatLoresXmlGroupedBlock([
      {
        lorebookName: '设定',
        entries: [{ name: '仅此一条', content: 'ONLY '.repeat(100) }],
      },
      {
        lorebookName: '摘要',
        entries: [{ name: 'MEMO', content: 'keep' }],
      },
    ])
    const state: PromptBudgetTrimState = {
      constantLore: [],
      matchedLore: [
        {
          lorebookId: 'lb1',
          lorebookName: '设定',
          entry: { ...loreEntry('only', 1, 'ONLY '.repeat(100)), title: '仅此一条' },
          mode: 'keyword',
          score: 1,
        },
        {
          lorebookId: 'lb2',
          lorebookName: '摘要',
          entry: { ...loreEntry('memo', 9, 'keep'), title: 'MEMO' },
          mode: 'keyword',
          score: 9,
        },
      ],
      memoryItems: [],
      knowledgeItems: [],
      historyMessages: [],
    }
    const slots = slotsFromAssembledMessages(
      [{ role: 'system', content: xml }],
      state,
    )
    const lore = slots[0]!
    assert.equal(lore.kind, 'lore')
    if (lore.kind !== 'lore') return
    lore.parts = lore.parts.filter((p) => p.id !== 'match:only')
    const msgs = projectPromptSlotsToMessages(slots)
    assert.equal(msgs.length, 1)
    assert.ok(!msgs[0]!.content.includes('设定'))
    assert.ok(msgs[0]!.content.includes('摘要'))
    assert.ok(msgs[0]!.content.includes('MEMO'))
    assert.equal(
      msgs[0]!.content,
      stripEmptyLorebookElements(mergeSlotContent(lore)),
    )
  })

  it('assigns distinct match ids when two entries share the same title', () => {
    const xml = [
      '<lores>',
      '  <lore name="同名">aaa</lore>',
      '  <lore name="同名">bbb</lore>',
      '</lores>',
    ].join('\n')
    const state: PromptBudgetTrimState = {
      constantLore: [],
      matchedLore: [
        {
          lorebookId: 'lb',
          lorebookName: 'W',
          entry: { ...loreEntry('a', 1, 'aaa'), title: '同名' },
          mode: 'keyword',
          score: 1,
        },
        {
          lorebookId: 'lb',
          lorebookName: 'W',
          entry: { ...loreEntry('b', 2, 'bbb'), title: '同名' },
          mode: 'keyword',
          score: 2,
        },
      ],
      memoryItems: [],
      knowledgeItems: [],
      historyMessages: [],
    }
    const slots = slotsFromAssembledMessages(
      [{ role: 'system', content: xml }],
      state,
    )
    assert.equal(slots[0]!.kind, 'lore')
    if (slots[0]!.kind !== 'lore') return
    const ids = slots[0]!.parts.filter((p) => p.trimmable).map((p) => p.id)
    assert.deepEqual(ids.sort(), ['match:a', 'match:b'])
  })

  it('advances histCursor by turnOrdinal even when content diverged', () => {
    const state: PromptBudgetTrimState = {
      constantLore: [],
      matchedLore: [],
      memoryItems: [],
      knowledgeItems: [],
      historyMessages: [
        { role: 'user', content: 'raw-u', turnOrdinal: 0, turnId: 't0' },
        { role: 'assistant', content: 'raw-a', turnOrdinal: 0, turnId: 't0' },
        { role: 'user', content: 'raw-u2', turnOrdinal: 1, turnId: 't1' },
      ],
    }
    const slots = slotsFromAssembledMessages(
      [
        { role: 'user', content: 'regex-u', turnOrdinal: 0, turnId: 't0' },
        { role: 'assistant', content: 'regex-a', turnOrdinal: 0, turnId: 't0' },
        { role: 'user', content: 'regex-u2', turnOrdinal: 1, turnId: 't1' },
      ],
      state,
    )
    assert.equal(slots.filter((s) => s.kind === 'history').length, 3)
    assert.ok(slots.every((s) => s.kind === 'history'))
  })
})
