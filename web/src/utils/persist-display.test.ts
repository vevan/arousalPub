import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ChatTurnItem } from '@/types/chat-turn'
import { applyPersistTurnPlugins, mergeReceiveRuntimeFromPersist } from './persist-display.js'

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
        pluginId: 'trace-keeper',
        schemaVersion: 1,
        payload: { state: { mood: 'calm' }, epoch: 0, receiveId: 'r1' },
      },
    ]
    const next = applyPersistTurnPlugins(turns, {
      ok: true,
      turnOrdinal: 0,
      receiveId: 'r1',
      plugins,
      trackerEpoch: 0,
    })
    assert.notEqual(next, turns)
    assert.deepEqual(next[0]?.plugins, plugins)
  })

  it('builds plugins from assistant when persist.plugins missing', () => {
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
      trackerEpoch: 2,
      finalAssistantContent:
        'reply<ex-trace-keeper>{"mood":"calm"}</ex-trace-keeper>',
    })
    const entry = next[0]?.plugins?.[0] as {
      pluginId: string
      payload: { state: { mood: string }; epoch: number; receiveId: string }
    }
    assert.equal(entry?.pluginId, 'trace-keeper')
    assert.deepEqual(entry?.payload.state, { mood: 'calm' })
    assert.equal(entry?.payload.epoch, 2)
    assert.equal(entry?.payload.receiveId, 'rx')
  })

  it('merges trace-keeper from assistant without wiping other plugins', () => {
    const guidance = {
      pluginId: 'guidance-generate',
      schemaVersion: 1,
      payload: { hint: 'stay in character' },
    }
    const turns: ChatTurnItem[] = [
      {
        turnOrdinal: 1,
        user: 'hi',
        receives: [{ id: 'rx', content: '' }],
        activeReceiveIndex: 0,
        plugins: [guidance],
      },
    ]
    const next = applyPersistTurnPlugins(turns, {
      ok: true,
      turnOrdinal: 1,
      receiveId: 'rx',
      trackerEpoch: 2,
      finalAssistantContent:
        'reply<ex-trace-keeper>{"mood":"calm"}</ex-trace-keeper>',
    })
    assert.equal(next[0]?.plugins?.length, 2)
    assert.deepEqual(next[0]?.plugins?.[0], guidance)
    const trace = next[0]?.plugins?.[1] as { pluginId: string }
    assert.equal(trace.pluginId, 'trace-keeper')
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
