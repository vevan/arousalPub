import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assemblePrompts,
  type PromptEntry,
  type PromptGroup,
  type PromptPreset,
} from './assemble-prompts.js'

const T = new Date().toISOString()

function makeEntry(
  partial: Partial<PromptEntry> & Pick<PromptEntry, 'id' | 'groupId' | 'content'>,
): PromptEntry {
  return {
    title: partial.title ?? partial.id,
    description: '',
    tags: [],
    enabled: true,
    role: 'system',
    injectionPosition: 'relative',
    injectionDepth: 0,
    injectionOrder: 100,
    triggers: [],
    order: 0,
    createdAt: T,
    updatedAt: T,
    ...partial,
  }
}

function makeGroup(partial: Partial<PromptGroup> & Pick<PromptGroup, 'id' | 'kind'>): PromptGroup {
  return {
    name: partial.id,
    order: 0,
    enabled: true,
    ...partial,
  }
}

function makePreset(
  groups: PromptGroup[],
  prompts: PromptEntry[],
): PromptPreset {
  return {
    id: 'preset-test',
    name: 'Test',
    groups,
    prompts,
    createdAt: T,
    updatedAt: T,
  }
}

describe('assemblePrompts group.enabled', () => {
  it('skips custom entries in a disabled normal group', () => {
    const pre = makeGroup({ id: 'g-pre', kind: 'normal', order: 0, enabled: false })
    const preset = makePreset(
      [pre],
      [
        makeEntry({
          id: 'e1',
          groupId: 'g-pre',
          content: 'custom-pre',
          order: 0,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset)
    assert.equal(messages.some((m) => m.content === 'custom-pre'), false)
  })

  it('keeps world binding when group custom entries are disabled', () => {
    const world = makeGroup({ id: 'g-world', kind: 'world', order: 0, enabled: false })
    const preset = makePreset(
      [world],
      [
        makeEntry({
          id: 'bound-world',
          groupId: 'g-world',
          content: '',
          bindingSlot: 'boundWorld',
          order: 0,
        }),
        makeEntry({
          id: 'extra',
          groupId: 'g-world',
          content: 'world-custom',
          order: 1,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset, {
      world: '<lore>castle</lore>',
    })
    assert.equal(messages.some((m) => m.content.includes('castle')), true)
    assert.equal(messages.some((m) => m.content === 'world-custom'), false)
  })

  it('skips chat-depth custom entries when their group is disabled', () => {
    const post = makeGroup({ id: 'g-post', kind: 'normal', order: 0, enabled: false })
    const preset = makePreset(
      [post],
      [
        makeEntry({
          id: 'chat-depth',
          groupId: 'g-post',
          content: 'depth-inject',
          injectionPosition: 'chat',
          injectionDepth: 0,
          order: 0,
        }),
      ],
    )
    const { messages } = assemblePrompts(preset)
    assert.equal(messages.some((m) => m.content === 'depth-inject'), false)
  })

  it('does not change entry.enabled when group is disabled (assembly only)', () => {
    const pre = makeGroup({ id: 'g-pre', kind: 'normal', order: 0, enabled: false })
    const entry = makeEntry({
      id: 'e1',
      groupId: 'g-pre',
      content: 'still-on',
      enabled: true,
      order: 0,
    })
    const preset = makePreset([pre], [entry])
    assemblePrompts(preset)
    assert.equal(preset.prompts[0]?.enabled, true)
  })
})
