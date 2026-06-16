import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeTurnPluginEntry, attachReceiveIdToTurnPluginEntries, removeTraceKeeperPluginForReceive } from './turn-plugin-utils.js'

describe('mergeTurnPluginEntry trace-keeper receiveId', () => {
  it('keeps distinct receive snapshots', () => {
    const merged = mergeTurnPluginEntry(
      [
        {
          pluginId: 'trace-keeper',
          schemaVersion: 1,
          payload: { state: { n: 1 }, epoch: 0, receiveId: 'r1' },
        },
      ],
      {
        pluginId: 'trace-keeper',
        schemaVersion: 1,
        payload: { state: { n: 2 }, epoch: 0, receiveId: 'r2' },
      },
    )
    assert.equal(merged.length, 2)
  })

  it('replaces same receiveId entry', () => {
    const merged = mergeTurnPluginEntry(
      [
        {
          pluginId: 'trace-keeper',
          schemaVersion: 1,
          payload: { state: { n: 1 }, epoch: 0, receiveId: 'r1' },
        },
      ],
      {
        pluginId: 'trace-keeper',
        schemaVersion: 1,
        payload: { state: { n: 9 }, epoch: 0, receiveId: 'r1' },
      },
    )
    assert.equal(merged.length, 1)
    assert.deepEqual(
      (merged[0] as { payload: { state: { n: number } } }).payload.state,
      { n: 9 },
    )
  })

  it('still replaces non trace-keeper by pluginId', () => {
    const merged = mergeTurnPluginEntry(
      [{ pluginId: 'other', schemaVersion: 1, payload: { a: 1 } }],
      { pluginId: 'other', schemaVersion: 1, payload: { a: 2 } },
    )
    assert.equal(merged.length, 1)
  })
})

describe('attachReceiveIdToTurnPluginEntries', () => {
  it('adds receiveId to trace-keeper payload', () => {
    const out = attachReceiveIdToTurnPluginEntries(
      [{ pluginId: 'trace-keeper', schemaVersion: 1, payload: { state: {}, epoch: 0 } }],
      'rx1',
    )
    assert.equal(out?.[0]?.payload.receiveId, 'rx1')
  })
})

describe('removeTraceKeeperPluginForReceive', () => {
  it('removes snapshot for matching receiveId only', () => {
    const out = removeTraceKeeperPluginForReceive(
      [
        {
          pluginId: 'trace-keeper',
          schemaVersion: 1,
          payload: { state: { n: 1 }, epoch: 0, receiveId: 'r1' },
        },
        {
          pluginId: 'trace-keeper',
          schemaVersion: 1,
          payload: { state: { n: 2 }, epoch: 0, receiveId: 'r2' },
        },
      ],
      'r1',
    )
    assert.equal(out.length, 1)
    assert.equal(
      (out[0] as { payload: { receiveId: string } }).payload.receiveId,
      'r2',
    )
  })
})
