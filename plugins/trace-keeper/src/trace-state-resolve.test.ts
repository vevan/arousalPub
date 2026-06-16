import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  findTracePayloadInTurnPlugins,
  resolveLiveTraceState,
} from './trace-state-resolve.js'

const entry = (state: Record<string, unknown>, receiveId?: string) => ({
  pluginId: 'trace-keeper',
  schemaVersion: 1,
  payload: {
    state,
    epoch: 0,
    ...(receiveId ? { receiveId } : {}),
  },
})

describe('findTracePayloadInTurnPlugins', () => {
  it('does not parse assistant body when receiveId missing in plugins', () => {
    const hit = findTracePayloadInTurnPlugins(
      [],
      0,
      {
        activeReceiveIndex: 0,
        receives: [
          {
            id: 'r1',
            content:
              '<ex-trace-keeper>{"scene":{"location":"X"}}</ex-trace-keeper>',
          },
        ],
      },
    )
    assert.equal(hit, null)
  })

  it('matches receiveId snapshot only', () => {
    const hit = findTracePayloadInTurnPlugins(
      [entry({ n: 1 }, 'r1'), entry({ n: 2 }, 'r2')],
      0,
      { activeReceiveIndex: 1, receives: [{ id: 'r1' }, { id: 'r2' }] },
    )
    assert.deepEqual(hit?.state, { n: 2 })
  })
})

describe('resolveLiveTraceState', () => {
  it('only inspects the last turn', () => {
    const turns = [
      {
        turnOrdinal: 1,
        plugins: [entry({ from: 'first' })],
        activeReceiveIndex: 0,
        receives: [{ id: 'a' }],
      },
      {
        turnOrdinal: 2,
        plugins: [],
        activeReceiveIndex: 0,
        receives: [{ id: 'b' }],
      },
    ]
    assert.equal(resolveLiveTraceState(turns, 0), null)
  })
})
