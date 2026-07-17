import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PromptEntry } from '../src/assemble-prompts.js'
import {
  ST_ANCHOR_BINDING_SLOT,
  SYSTEM_BINDING_SLOTS,
  finalizeCharacterGroupBindings,
  pinPostHistoryAfterChatHistory,
} from '../src/system-binding-slots.js'

const CHAR_G = 'group-character'
const T = new Date().toISOString()

function makeEntry(
  partial: Partial<PromptEntry> & Pick<PromptEntry, 'id' | 'bindingSlot' | 'order'>,
): PromptEntry {
  return {
    groupId: CHAR_G,
    title: '',
    content: '',
    description: '',
    tags: [],
    enabled: true,
    role: 'system',
    injectionPosition: 'relative',
    injectionDepth: 0,
    injectionOrder: 100,
    triggers: [],
    createdAt: T,
    updatedAt: T,
    ...partial,
  }
}

describe('finalizeCharacterGroupBindings', () => {
  it('keeps charDescription after scenario when system is added', () => {
    const prompts = finalizeCharacterGroupBindings(
      [
        makeEntry({
          id: 'p1',
          bindingSlot: 'boundUserPersona',
          order: 0,
        }),
        makeEntry({
          id: 'sc',
          bindingSlot: 'boundScenario',
          order: 1,
        }),
        makeEntry({
          id: 'd1',
          bindingSlot: 'boundCharDescription',
          order: 2,
        }),
        makeEntry({
          id: 'pe',
          bindingSlot: 'boundCharPersonality',
          order: 3,
        }),
      ],
      CHAR_G,
      (slot, order, id, enabled = true) =>
        makeEntry({ id, bindingSlot: slot, order, enabled }),
    )
    const slots = prompts
      .filter((e) => e.bindingSlot)
      .sort((a, b) => a.order - b.order)
      .map((e) => e.bindingSlot)
    assert.deepEqual(slots, [
      'boundUserPersona',
      'boundScenario',
      'boundCharSystemPrompt',
      'boundCharDescription',
      'boundCharPersonality',
    ])
  })

  it('inserts boundCharSystemPrompt before charDescription when adjacent to persona', () => {
    const prompts = finalizeCharacterGroupBindings(
      [
        makeEntry({
          id: 'p1',
          bindingSlot: 'boundUserPersona',
          order: 0,
        }),
        makeEntry({
          id: 'd1',
          bindingSlot: 'boundCharDescription',
          order: 1,
        }),
      ],
      CHAR_G,
      (slot, order, id, enabled = true) =>
        makeEntry({ id, bindingSlot: slot, order, enabled }),
    )
    const slots = prompts
      .filter((e) => e.bindingSlot)
      .sort((a, b) => a.order - b.order)
      .map((e) => e.bindingSlot)
    assert.deepEqual(slots, [
      'boundUserPersona',
      'boundCharSystemPrompt',
      'boundCharDescription',
    ])
  })

  it('re-pins misplaced system at charDescription order without moving scenario', () => {
    const prompts = finalizeCharacterGroupBindings(
      [
        makeEntry({
          id: 'p1',
          bindingSlot: 'boundUserPersona',
          order: 0,
        }),
        makeEntry({
          id: 'sc',
          bindingSlot: 'boundScenario',
          order: 1,
        }),
        makeEntry({
          id: 'd1',
          bindingSlot: 'boundCharDescription',
          order: 2,
        }),
        makeEntry({
          id: 'sys-wrong',
          bindingSlot: 'boundCharSystemPrompt',
          order: 99,
        }),
      ],
      CHAR_G,
      (slot, order, id, enabled = true) =>
        makeEntry({ id, bindingSlot: slot, order, enabled }),
    )
    const slots = prompts
      .filter((e) => e.bindingSlot)
      .sort((a, b) => a.order - b.order)
      .map((e) => e.bindingSlot)
    assert.deepEqual(slots, [
      'boundUserPersona',
      'boundScenario',
      'boundCharSystemPrompt',
      'boundCharDescription',
    ])
  })

  it('pins boundCharSystemPrompt before description when missing', () => {
    const prompts = finalizeCharacterGroupBindings(
      [
        makeEntry({
          id: 'd1',
          bindingSlot: 'boundCharDescription',
          order: 1,
        }),
      ],
      CHAR_G,
      (slot, order, id, enabled = true) =>
        makeEntry({ id, bindingSlot: slot, order, enabled }),
    )
    const sys = prompts.find((e) => e.bindingSlot === 'boundCharSystemPrompt')
    assert.ok(sys)
    assert.equal(sys?.enabled, true)
    assert.equal(sys?.order, 1)
    const desc = prompts.find((e) => e.bindingSlot === 'boundCharDescription')
    assert.equal(desc?.order, 2)
  })
})

describe('pinPostHistoryAfterChatHistory', () => {
  it('inserts postHistory at chatHistory order + 1', () => {
    const HIST_G = 'group-history'
    const prompts = pinPostHistoryAfterChatHistory(
      [
        makeEntry({
          id: 'hist',
          groupId: HIST_G,
          bindingSlot: 'boundChatHistory',
          order: 2,
        }),
        makeEntry({
          id: 'tail',
          groupId: HIST_G,
          order: 9,
        }),
      ],
      HIST_G,
      (slot, order, id, enabled = true) =>
        makeEntry({ id, groupId: HIST_G, bindingSlot: slot, order, enabled }),
    )
    const post = prompts.find((e) => e.bindingSlot === 'boundCharacterPostHistory')
    assert.equal(post?.order, 3)
    assert.equal(prompts.find((e) => e.id === 'tail')?.order, 10)
  })
})

describe('system binding slot inventory', () => {
  it('keeps 15 product system slots and 10 ST anchor mappings', () => {
    assert.equal(SYSTEM_BINDING_SLOTS.length, 15)
    assert.equal(Object.keys(ST_ANCHOR_BINDING_SLOT).length, 10)
    assert.ok(
      SYSTEM_BINDING_SLOTS.includes('boundCharacterPostHistory'),
      'post-history slot remains for native presets / normalize',
    )
    assert.ok(
      SYSTEM_BINDING_SLOTS.includes('boundKnowledge'),
      'knowledge slot for document RAG injection',
    )
  })
})
