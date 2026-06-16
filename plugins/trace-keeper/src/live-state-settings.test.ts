import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  LIVE_STATE_TURN_COUNT_DEFAULT,
  LIVE_STATE_TURN_COUNT_MAX,
  normalizeLiveStateTurnCount,
  resolveLiveStateTurnCount,
} from './live-state-settings.js'
import {
  findTracePayloadInTurnPlugins,
  resolveLiveTraceStates,
} from './trace-state-resolve.js'
import { extractTraceKeeperState } from './parse-block.js'

describe('normalizeLiveStateTurnCount', () => {
  it('defaults to 1', () => {
    assert.equal(normalizeLiveStateTurnCount(undefined), LIVE_STATE_TURN_COUNT_DEFAULT)
  })

  it('clamps to [0, 8]', () => {
    assert.equal(normalizeLiveStateTurnCount(-1), 0)
    assert.equal(normalizeLiveStateTurnCount(99), LIVE_STATE_TURN_COUNT_MAX)
  })
})

describe('resolveLiveStateTurnCount', () => {
  it('prefers conversation override', () => {
    assert.equal(
      resolveLiveStateTurnCount({ liveStateTurnCount: 3 }, { liveStateTurnCount: 1 }),
      1,
    )
  })
})

describe('findTracePayloadInTurnPlugins activeReceiveIndex', () => {
  const epoch = 0
  const block = (state: Record<string, unknown>) =>
    `<ex-trace-keeper>${JSON.stringify(state)}</ex-trace-keeper>`

  it('picks payload matching active receiveId', () => {
    const plugins = [
      {
        pluginId: 'trace-keeper',
        payload: { state: { n: 1 }, epoch, receiveId: 'r1' },
      },
      {
        pluginId: 'trace-keeper',
        payload: { state: { n: 2 }, epoch, receiveId: 'r2' },
      },
    ]
    const hit = findTracePayloadInTurnPlugins(plugins, epoch, {
      activeReceiveIndex: 1,
      receives: [
        { id: 'r1', content: '' },
        { id: 'r2', content: '' },
      ],
    })
    assert.deepEqual(hit?.state, { n: 2 })
  })

  it('returns null when receiveId has no plugins snapshot', () => {
    const hit = findTracePayloadInTurnPlugins([], epoch, {
      activeReceiveIndex: 0,
      receives: [{ id: 'r1', content: block({ mood: 'calm' }) }],
    })
    assert.equal(hit, null)
  })
})

describe('resolveLiveTraceStates', () => {
  const epoch = 0
  const pluginPayload = (state: Record<string, unknown>, receiveId?: string) => [
    {
      pluginId: 'trace-keeper',
      payload: {
        state,
        epoch,
        ...(receiveId ? { receiveId } : {}),
      },
    },
  ]

  it('returns newest single state when limit is 1', () => {
    const turns = [
      {
        turnOrdinal: 1,
        activeReceiveIndex: 0,
        receives: [{ id: 'a', content: '' }],
        plugins: pluginPayload({ n: 1 }, 'a'),
      },
      {
        turnOrdinal: 2,
        activeReceiveIndex: 0,
        receives: [{ id: 'b', content: '' }],
        plugins: pluginPayload({ n: 2 }, 'b'),
      },
    ]
    const states = resolveLiveTraceStates(turns, epoch, 1)
    assert.equal(states.length, 1)
    assert.equal(states[0]!.turnOrdinal, 2)
  })

  it('uses each turn active receive when resolving history', () => {
    const turns = [
      {
        turnOrdinal: 1,
        activeReceiveIndex: 0,
        receives: [{ id: 'a', content: '' }],
        plugins: pluginPayload({ n: 1 }, 'a'),
      },
      {
        turnOrdinal: 2,
        activeReceiveIndex: 1,
        receives: [
          { id: 'b0', content: '' },
          { id: 'b1', content: '' },
        ],
        plugins: [
          {
            pluginId: 'trace-keeper',
            payload: { state: { n: 20 }, epoch, receiveId: 'b0' },
          },
          {
            pluginId: 'trace-keeper',
            payload: { state: { n: 21 }, epoch, receiveId: 'b1' },
          },
        ],
      },
    ]
    const states = resolveLiveTraceStates(turns, epoch, 2)
    assert.deepEqual(
      states.map((s) => s.state),
      [{ n: 1 }, { n: 21 }],
    )
  })
})

describe('extractTraceKeeperState', () => {
  it('parses block for swipe fallback', () => {
    assert.deepEqual(
      extractTraceKeeperState('hello<ex-trace-keeper>{"x":1}</ex-trace-keeper>'),
      { x: 1 },
    )
  })
})
