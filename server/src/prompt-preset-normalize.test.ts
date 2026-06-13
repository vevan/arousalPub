import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PromptEntry, PromptGroup, PromptPreset } from './assemble-prompts.js'
import { normalizePresetForAssemble } from './prompt-preset-normalize.js'

const T = '2026-01-01T00:00:00.000Z'

const DEFAULT_GROUPS: PromptGroup[] = [
  { id: 'group-pre', name: 'Pre', kind: 'normal', order: 0 },
  { id: 'group-character', name: 'Character', kind: 'character', order: 1 },
  { id: 'group-world', name: 'World', kind: 'world', order: 2 },
  { id: 'group-history', name: 'History', kind: 'history', order: 3 },
  { id: 'group-user-input', name: 'User input', kind: 'userInput', order: 4 },
  { id: 'group-post', name: 'Post', kind: 'normal', order: 5 },
]

function makeEntry(
  partial: Partial<PromptEntry> &
    Pick<PromptEntry, 'id' | 'groupId' | 'order'> & {
      bindingSlot?: PromptEntry['bindingSlot']
    },
): PromptEntry {
  return {
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

function makePreset(
  prompts: PromptEntry[],
  extra: Partial<PromptPreset> = {},
): PromptPreset {
  return {
    id: 'preset-1',
    name: 'Test',
    groups: DEFAULT_GROUPS,
    prompts,
    createdAt: T,
    updatedAt: T,
    ...extra,
  }
}

function bindingOrder(preset: PromptPreset, groupId: string) {
  return preset.prompts
    .filter((e) => e.groupId === groupId && e.bindingSlot)
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((e) => ({ slot: e.bindingSlot, order: e.order, enabled: e.enabled }))
}

describe('normalizePresetForAssemble', () => {
  it('seeds default character/history/world/userInput slots on empty binding preset', () => {
    const out = normalizePresetForAssemble(makePreset([]))
    assert.deepEqual(
      bindingOrder(out, 'group-character').map((x) => x.slot),
      [
        'boundUserPersona',
        'boundCharSystemPrompt',
        'boundCharDescription',
        'boundCharPersonality',
        'boundScenario',
      ],
    )
    assert.deepEqual(
      bindingOrder(out, 'group-history').map((x) => x.slot),
      ['boundChatHistory', 'boundCharacterPostHistory'],
    )
    assert.deepEqual(
      bindingOrder(out, 'group-world').map((x) => x.slot),
      ['boundWorldBefore'],
    )
    assert.deepEqual(
      bindingOrder(out, 'group-user-input').map((x) => x.slot),
      ['boundUserInput'],
    )
  })

  it('pins boundCharacterPostHistory immediately after boundChatHistory', () => {
    const out = normalizePresetForAssemble(
      makePreset([
        makeEntry({
          id: 'custom',
          groupId: 'group-history',
          order: 0,
          content: 'note',
        }),
        makeEntry({
          id: 'hist',
          groupId: 'group-history',
          order: 1,
          bindingSlot: 'boundChatHistory',
        }),
        makeEntry({
          id: 'tail',
          groupId: 'group-history',
          order: 5,
          content: 'after',
        }),
      ]),
    )
    const hist = bindingOrder(out, 'group-history')
    const chat = hist.find((x) => x.slot === 'boundChatHistory')
    const post = hist.find((x) => x.slot === 'boundCharacterPostHistory')
    assert.ok(chat && post)
    assert.equal(post.order, chat.order + 1)
    assert.equal(out.prompts.find((e) => e.id === 'tail')?.order, 6)
  })

  it('does not append postHistory at group tail when chatHistory exists', () => {
    const out = normalizePresetForAssemble(
      makePreset([
        makeEntry({
          id: 'hist',
          groupId: 'group-history',
          order: 0,
          bindingSlot: 'boundChatHistory',
        }),
        makeEntry({
          id: 'tail',
          groupId: 'group-history',
          order: 9,
          content: 'tail custom',
        }),
      ]),
    )
    const post = out.prompts.find(
      (e) => e.bindingSlot === 'boundCharacterPostHistory',
    )
    assert.ok(post)
    assert.equal(post.order, 1)
    assert.equal(
      out.prompts.find((e) => e.id === 'tail')?.order,
      10,
    )
  })

  it('uses presetUsesSystemSubBlocks on migrated prompts (system sub preset path)', () => {
    const out = normalizePresetForAssemble(
      makePreset([
        makeEntry({
          id: 'main',
          groupId: 'group-pre',
          order: 0,
          bindingSlot: 'boundMain',
        }),
        makeEntry({
          id: 'hist',
          groupId: 'group-history',
          order: 0,
          bindingSlot: 'boundChatHistory',
        }),
      ]),
    )
    assert.ok(
      out.prompts.some((e) => e.bindingSlot === 'boundCharacterPostHistory'),
    )
    assert.ok(
      !out.prompts.some(
        (e) =>
          e.groupId === 'group-character' &&
          e.bindingSlot === 'boundCharacterSystem',
      ),
    )
  })

  it('migrates characterBundlePosition to flat order before finalize', () => {
    const out = normalizePresetForAssemble(
      makePreset([
        makeEntry({
          id: 'after',
          groupId: 'group-character',
          order: 0,
          characterBundlePosition: 'after',
          content: 'after custom',
        }),
        makeEntry({
          id: 'legacy',
          groupId: 'group-character',
          order: 0,
          bindingSlot: 'boundCharacterSystem',
        }),
        makeEntry({
          id: 'before',
          groupId: 'group-character',
          order: 1,
          content: 'before custom',
        }),
      ]),
    )
    const charCustom = out.prompts
      .filter((e) => e.groupId === 'group-character' && !e.bindingSlot)
      .sort((a, b) => a.order - b.order)
      .map((e) => e.id)
    assert.deepEqual(charCustom, ['before', 'after'])
    assert.ok(
      !out.prompts.some((e) => e.characterBundlePosition != null),
    )
  })

  it('inherits useBoundCharacterSystemPrompt into char system enabled', () => {
    const out = normalizePresetForAssemble(
      makePreset(
        [
          makeEntry({
            id: 'legacy',
            groupId: 'group-character',
            order: 0,
            bindingSlot: 'boundCharacterSystem',
            enabled: true,
          }),
          makeEntry({
            id: 'desc',
            groupId: 'group-character',
            order: 1,
            bindingSlot: 'boundCharDescription',
          }),
        ],
        { useBoundCharacterSystemPrompt: false } as PromptPreset,
      ),
    )
    const sys = out.prompts.find(
      (e) => e.bindingSlot === 'boundCharSystemPrompt',
    )
    assert.equal(sys?.enabled, false)
  })

  it('forces required binding slots enabled', () => {
    const out = normalizePresetForAssemble(
      makePreset([
        makeEntry({
          id: 'persona',
          groupId: 'group-character',
          order: 0,
          bindingSlot: 'boundUserPersona',
          enabled: false,
        }),
      ]),
    )
    const persona = out.prompts.find((e) => e.bindingSlot === 'boundUserPersona')
    assert.equal(persona?.enabled, true)
  })
})
