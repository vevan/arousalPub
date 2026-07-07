import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  mergePluginSettingsPartial,
  readConversationPluginSettings,
  type ConversationIndex,
} from '../src/chat-storage.js'

const FIXTURE_PLUGIN = 'fixture-plugin-a'

describe('readConversationPluginSettings', () => {
  const base: ConversationIndex = {
    schemaVersion: 1,
    conversationId: 'abc12345',
    title: 't',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    headChunkFile: null,
    tailChunkFile: null,
  }

  it('returns empty object when missing', () => {
    assert.deepEqual(readConversationPluginSettings(base, FIXTURE_PLUGIN), {})
  })

  it('returns shallow copy of plugin bag', () => {
    const idx: ConversationIndex = {
      ...base,
      pluginSettings: {
        [FIXTURE_PLUGIN]: { targetLorebookId: 'lore-1', triggerEveryNTurns: 4 },
      },
    }
    const got = readConversationPluginSettings(idx, FIXTURE_PLUGIN)
    assert.deepEqual(got, { targetLorebookId: 'lore-1', triggerEveryNTurns: 4 })
    got.triggerEveryNTurns = 99
    assert.equal(idx.pluginSettings?.[FIXTURE_PLUGIN]?.triggerEveryNTurns, 4)
  })
})

describe('mergePluginSettingsPartial', () => {
  it('merges new keys', () => {
    assert.deepEqual(
      mergePluginSettingsPartial({ a: 1 }, { b: 2 }),
      { a: 1, b: 2 },
    )
  })

  it('deletes keys when value is null', () => {
    assert.deepEqual(
      mergePluginSettingsPartial(
        { sidecarEntryId: 'e1', triggerEveryNTurns: 4 },
        { sidecarEntryId: null },
      ),
      { triggerEveryNTurns: 4 },
    )
  })

  it('overwrites existing keys', () => {
    assert.deepEqual(
      mergePluginSettingsPartial({ n: 2 }, { n: 5 }),
      { n: 5 },
    )
  })
})
