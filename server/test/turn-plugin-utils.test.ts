import assert from 'node:assert/strict'
import { afterEach, beforeEach, describe, it } from 'node:test'
import {
  __resetTurnPluginPoliciesForTest,
  __setTurnPluginPolicyForTest,
} from '../src/plugin-system/turn-plugin-policies.js'
import {
  mergeTurnPluginEntry,
  attachReceiveIdToTurnPluginEntries,
  removeTurnPluginEntriesForReceive,
  mergePersistTurnPlugins,
} from '../src/turn-plugin-utils.js'

const FIXTURE_PLUGIN = 'fixture-plugin-rcv'

beforeEach(() => {
  __setTurnPluginPolicyForTest(FIXTURE_PLUGIN, {
    mode: 'receive-scoped',
    receiveIdKey: 'receiveId',
  })
})

afterEach(() => {
  __resetTurnPluginPoliciesForTest()
})

describe('mergeTurnPluginEntry receive-scoped', () => {
  it('keeps distinct receive snapshots', () => {
    const merged = mergeTurnPluginEntry(
      [
        {
          pluginId: FIXTURE_PLUGIN,
          schemaVersion: 1,
          payload: { state: { n: 1 }, epoch: 0, receiveId: 'r1' },
        },
      ],
      {
        pluginId: FIXTURE_PLUGIN,
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
          pluginId: FIXTURE_PLUGIN,
          schemaVersion: 1,
          payload: { state: { n: 1 }, epoch: 0, receiveId: 'r1' },
        },
      ],
      {
        pluginId: FIXTURE_PLUGIN,
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

  it('still replaces default-policy plugin by pluginId', () => {
    const merged = mergeTurnPluginEntry(
      [{ pluginId: 'fixture-plugin-other', schemaVersion: 1, payload: { a: 1 } }],
      { pluginId: 'fixture-plugin-other', schemaVersion: 1, payload: { a: 2 } },
    )
    assert.equal(merged.length, 1)
  })
})

describe('attachReceiveIdToTurnPluginEntries', () => {
  it('adds receiveId to receive-scoped payload', () => {
    const out = attachReceiveIdToTurnPluginEntries(
      [{ pluginId: FIXTURE_PLUGIN, schemaVersion: 1, payload: { state: {}, epoch: 0 } }],
      'rx1',
    )
    assert.equal(out?.[0]?.payload.receiveId, 'rx1')
  })
})

describe('mergePersistTurnPlugins', () => {
  it('merges new receive snapshot onto existing turn plugins', () => {
    const out = mergePersistTurnPlugins(
      [
        {
          pluginId: FIXTURE_PLUGIN,
          schemaVersion: 1,
          payload: { state: { n: 1 }, epoch: 0, receiveId: 'r1' },
        },
      ],
      [{ pluginId: FIXTURE_PLUGIN, schemaVersion: 1, payload: { state: { n: 2 }, epoch: 0 } }],
      'r2',
    )
    assert.equal(out.length, 2)
    assert.equal(
      (out[1] as { payload: { receiveId: string } }).payload.receiveId,
      'r2',
    )
  })
})

describe('removeTurnPluginEntriesForReceive', () => {
  it('removes snapshot for matching receiveId only', () => {
    const out = removeTurnPluginEntriesForReceive(
      [
        {
          pluginId: FIXTURE_PLUGIN,
          schemaVersion: 1,
          payload: { state: { n: 1 }, epoch: 0, receiveId: 'r1' },
        },
        {
          pluginId: FIXTURE_PLUGIN,
          schemaVersion: 1,
          payload: { state: { n: 2 }, epoch: 0, receiveId: 'r2' },
        },
      ],
      'r1',
      FIXTURE_PLUGIN,
    )
    assert.equal(out.length, 1)
    assert.equal(
      (out[0] as { payload: { receiveId: string } }).payload.receiveId,
      'r2',
    )
  })
})
