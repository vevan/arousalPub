import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PromptPreset } from './assemble-prompts.js'
import { normalizePresetForAssemble } from './prompt-preset-normalize.js'
import { runPromptsAssemblePreview } from './prompts-assemble-preview.js'
import type { PromptsDocument } from './prompts-file.js'

const T = '2026-01-01T00:00:00.000Z'

describe('runPromptsAssemblePreview', () => {
  it('uses binding inject placeholders instead of default sample character text', () => {
    const preset = normalizePresetForAssemble({
      id: 'p1',
      name: 'Default',
      groups: [
        { id: 'group-pre', name: 'Pre', kind: 'normal', order: 0 },
        { id: 'group-character', name: 'Character', kind: 'character', order: 1 },
        { id: 'group-world', name: 'World', kind: 'world', order: 2 },
        { id: 'group-history', name: 'History', kind: 'history', order: 3 },
        { id: 'group-user-input', name: 'User input', kind: 'userInput', order: 4 },
        { id: 'group-post', name: 'Post', kind: 'normal', order: 5 },
      ],
      prompts: [],
      createdAt: T,
      updatedAt: T,
    } satisfies PromptPreset)

    const doc: PromptsDocument = {
      schemaVersion: 1,
      activePresetId: 'p1',
      presets: [preset],
    }

    const result = runPromptsAssemblePreview(doc, { presetId: 'p1' })
    assert.ok(!('error' in result))
    if ('error' in result) return

    const contents = result.messages.map((m) => m.content)
    assert.equal(
      contents.some((c) => c.includes('Sample system_prompt')),
      false,
    )
    assert.equal(
      contents.some((c) => c.includes('Sample post_history')),
      false,
    )
    assert.equal(
      contents.some((c) => c.includes('<inject slot="bound_character.system_prompt" />')),
      true,
    )
    assert.equal(
      contents.some((c) => c.includes('<inject slot="chat_history" />')),
      true,
    )
  })
})
