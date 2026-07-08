import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  findTracePayloadForTurn,
  findTracePayloadInTurnPlugins,
  resolveLiveTraceState,
  resolveLiveTraceStates,
  resolveTraceForSegment,
} from '../src/trace-state-resolve.js'

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

  it('returns null when segment has no receives yet (awaiting reply)', () => {
    const hit = findTracePayloadInTurnPlugins(
      [entry({ n: 1 }, 'r0')],
      0,
      { activeReceiveIndex: 0, receives: [] },
    )
    assert.equal(hit, null)
  })
})

describe('resolveTraceForSegment', () => {
  it('resolves per segment in multi-segment turn', () => {
    const turn = {
      turnOrdinal: 3,
      activeSegmentIndex: 1,
      segments: [
        {
          receives: [{ id: 'r0', content: 'a' }],
          activeReceiveIndex: 0,
        },
        {
          receives: [{ id: 'r1', content: 'b' }],
          activeReceiveIndex: 0,
        },
      ],
      plugins: [entry({ bot: 'alice' }, 'r0'), entry({ bot: 'betty' }, 'r1')],
    }
    const a = resolveTraceForSegment(turn, 0, 0)
    const b = resolveTraceForSegment(turn, 0, 1)
    assert.deepEqual(a?.state, { bot: 'alice' })
    assert.deepEqual(b?.state, { bot: 'betty' })
  })

  it('defaults to activeSegmentIndex when segmentIndex omitted', () => {
    const turn = {
      turnOrdinal: 1,
      activeSegmentIndex: 0,
      segments: [
        {
          receives: [{ id: 'r0' }],
          activeReceiveIndex: 0,
        },
        {
          receives: [{ id: 'r1' }],
          activeReceiveIndex: 0,
        },
      ],
      plugins: [entry({ n: 0 }, 'r0'), entry({ n: 1 }, 'r1')],
    }
    assert.deepEqual(findTracePayloadForTurn(turn, 0)?.state, { n: 0 })
  })
})

describe('resolveLiveTraceStates', () => {
  it('expands all segments in multi-segment turn', () => {
    const turn = {
      turnOrdinal: 3,
      activeSegmentIndex: 1,
      segments: [
        {
          receives: [{ id: 'r0' }],
          activeReceiveIndex: 0,
        },
        {
          receives: [{ id: 'r1' }],
          activeReceiveIndex: 0,
        },
      ],
      plugins: [entry({ bot: 'alice' }, 'r0'), entry({ bot: 'betty' }, 'r1')],
    }
    const hits = resolveLiveTraceStates([turn], 0, 4)
    assert.equal(hits.length, 2)
    assert.deepEqual(hits[0], {
      state: { bot: 'alice' },
      turnOrdinal: 3,
      segmentIndex: 0,
    })
    assert.deepEqual(hits[1], {
      state: { bot: 'betty' },
      turnOrdinal: 3,
      segmentIndex: 1,
    })
  })
})

describe('resolveLiveTraceState', () => {
  it('only inspects the last turn active segment', () => {
    const turns = [
      {
        turnOrdinal: 1,
        plugins: [entry({ from: 'first' }, 'a')],
        activeSegmentIndex: 0,
        segments: [
          { receives: [{ id: 'a' }], activeReceiveIndex: 0 },
        ],
      },
      {
        turnOrdinal: 2,
        plugins: [],
        activeSegmentIndex: 0,
        segments: [
          { receives: [{ id: 'b' }], activeReceiveIndex: 0 },
        ],
      },
    ]
    assert.equal(resolveLiveTraceState(turns, 0), null)
  })
})
