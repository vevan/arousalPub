import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildDefaultPromptPreset,
  buildGroupChatPromptPreset,
  DEFAULT_PROMPT_PRESET_ID,
  GROUP_CHAT_PRESET_ID,
  isPromptsSeedPut,
  SEED_PRESET_IDS,
} from '../src/prompts-default-seed.js'

describe('prompts-default-seed', () => {
  it('seeds default + group chat presets', () => {
    const def = buildDefaultPromptPreset() as { id: string; prompts: unknown[] }
    const group = buildGroupChatPromptPreset() as {
      id: string
      name: string
      prompts: Array<{ id: string; enabled: boolean; content: string }>
    }
    assert.equal(def.id, DEFAULT_PROMPT_PRESET_ID)
    assert.equal(group.id, GROUP_CHAT_PRESET_ID)
    assert.equal(group.name, 'Group chat')
    const groupSeeds = group.prompts.filter((p) => p.id.startsWith('seed-group-'))
    assert.equal(groupSeeds.length, 3)
    assert.ok(groupSeeds.every((p) => p.enabled === false))
    assert.ok(groupSeeds.some((p) => p.content.includes('{{group}}')))
    assert.ok(groupSeeds.some((p) => p.content.includes('{{notChar}}')))
    assert.ok(groupSeeds.some((p) => p.content.includes('{{charIfNotGroup}}')))
  })

  it('isPromptsSeedPut matches both seed presets', () => {
    assert.equal(
      isPromptsSeedPut({
        activePresetId: DEFAULT_PROMPT_PRESET_ID,
        presets: [buildDefaultPromptPreset(), buildGroupChatPromptPreset()],
      }),
      true,
    )
    assert.equal(
      isPromptsSeedPut({
        activePresetId: DEFAULT_PROMPT_PRESET_ID,
        presets: [buildDefaultPromptPreset()],
      }),
      false,
    )
    assert.equal(
      isPromptsSeedPut({
        activePresetId: GROUP_CHAT_PRESET_ID,
        presets: [buildDefaultPromptPreset(), buildGroupChatPromptPreset()],
      }),
      false,
    )
  })

  it('SEED_PRESET_IDS lists seed preset ids', () => {
    assert.deepEqual(SEED_PRESET_IDS, [
      DEFAULT_PROMPT_PRESET_ID,
      GROUP_CHAT_PRESET_ID,
    ])
  })
})
