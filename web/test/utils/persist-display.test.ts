import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatTurnItem } from '../../src/types/chat-turn.js'
import { applyPersistTurnPlugins, mergeReceiveRuntimeFromPersist } from '../../src/utils/persist-display.js'

describe('mergeReceiveRuntimeFromPersist', () => {
  it('fills missing token fields from persist', () => {
    const merged = mergeReceiveRuntimeFromPersist(
      { id: 'r1', content: 'hi', durationMs: 100 },
      {
        ok: true,
        estimatedTokens: 1200,
        completionTokens: 88,
        model: 'gpt-test',
      },
    )
    assert.equal(merged.estimatedTokens, 1200)
    assert.equal(merged.completionTokens, 88)
    assert.equal(merged.model, 'gpt-test')
    assert.equal(merged.durationMs, 100)
  })

  it('does not overwrite existing receive metrics', () => {
    const merged = mergeReceiveRuntimeFromPersist(
      {
        id: 'r1',
        content: 'hi',
        estimatedTokens: 500,
        completionTokens: 40,
      },
      { ok: true, estimatedTokens: 1200, completionTokens: 88 },
    )
    assert.equal(merged.estimatedTokens, 500)
    assert.equal(merged.completionTokens, 40)
  })
})

describe('applyPersistTurnPlugins', () => {
  it('patches plugins on matching turnOrdinal', () => {
    const turns: ChatTurnItem[] = [
      {
        turnOrdinal: 0,
        user: 'hi',
        receives: [{ id: 'r1', content: 'ok' }],
        activeReceiveIndex: 0,
      },
    ]
    const plugins = [
      {
        pluginId: 'fixture-plugin-a',
        schemaVersion: 1,
        payload: { state: { mood: 'calm' }, epoch: 0, receiveId: 'r1' },
      },
    ]
    const next = applyPersistTurnPlugins(turns, {
      ok: true,
      turnOrdinal: 0,
      receiveId: 'r1',
      plugins,
    })
    assert.notEqual(next, turns)
    assert.deepEqual(next[0]?.plugins, plugins)
  })

  it('no-op when persist.plugins missing', () => {
    const turns: ChatTurnItem[] = [
      {
        turnOrdinal: 1,
        user: 'hi',
        receives: [{ id: 'rx', content: '' }],
        activeReceiveIndex: 0,
      },
    ]
    const next = applyPersistTurnPlugins(turns, {
      ok: true,
      turnOrdinal: 1,
      receiveId: 'rx',
      finalAssistantContent: 'reply only',
    })
    assert.equal(next, turns)
  })

  it('patches turnId on matching turnOrdinal', () => {
    const turns: ChatTurnItem[] = [
      {
        turnOrdinal: 2,
        user: 'hi',
        receives: [{ id: 'r1', content: 'ok' }],
        activeReceiveIndex: 0,
      },
    ]
    const next = applyPersistTurnPlugins(turns, {
      ok: true,
      turnOrdinal: 2,
      turnId: 't9',
    })
    assert.notEqual(next, turns)
    assert.equal(next[0]?.turnId, 't9')
  })

  it('no-op when plugins missing', () => {
    const turns: ChatTurnItem[] = [
      {
        turnOrdinal: 0,
        user: 'hi',
        receives: [{ id: 'r1', content: 'ok' }],
        activeReceiveIndex: 0,
      },
    ]
    const next = applyPersistTurnPlugins(turns, { ok: true, turnOrdinal: 0 })
    assert.equal(next, turns)
  })
})
