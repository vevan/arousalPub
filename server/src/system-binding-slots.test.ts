import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PromptEntry } from './assemble-prompts.js'
import {
  ST_ANCHOR_BINDING_SLOT,
  SYSTEM_BINDING_SLOTS,
  finalizeCharacterGroupBindings,
} from './system-binding-slots.js'

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

  it('removes legacy boundCharacterSystem when granular fields exist', () => {
    const prompts = finalizeCharacterGroupBindings(
      [
        makeEntry({
          id: 'legacy',
          bindingSlot: 'boundCharacterSystem',
          order: 0,
          enabled: false,
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
    assert.ok(
      !prompts.some((e) => e.bindingSlot === 'boundCharacterSystem'),
    )
    const sys = prompts.find((e) => e.bindingSlot === 'boundCharSystemPrompt')
    assert.equal(sys?.enabled, false)
  })
})

describe('system binding slot inventory', () => {
  it('keeps 14 product system slots and 10 ST anchor mappings', () => {
    assert.equal(SYSTEM_BINDING_SLOTS.length, 14)
    assert.equal(Object.keys(ST_ANCHOR_BINDING_SLOT).length, 10)
    assert.ok(
      SYSTEM_BINDING_SLOTS.includes('boundCharacterPostHistory'),
      'post-history slot remains for native presets / normalize',
    )
  })
})
