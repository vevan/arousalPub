import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  activeSegmentReceive,
  resolveSegmentIndexFromBody,
  segmentIndexForAction,
  type HostTurnWithSegments,
} from '../src/host-segment-snapshot.js'

const multiSegTurn: HostTurnWithSegments = {
  activeSegmentIndex: 1,
  segments: [
    {
      receives: [{ id: 'recv-a', content: 'Alice' }],
      activeReceiveIndex: 0,
    },
    {
      receives: [{ id: 'recv-b', content: 'Betty' }],
      activeReceiveIndex: 0,
    },
  ],
}

describe('resolveSegmentIndexFromBody', () => {
  it('resolves segmentIndex when in range', () => {
    assert.deepEqual(resolveSegmentIndexFromBody(multiSegTurn, { segmentIndex: 0 }), {
      kind: 'ok',
      segmentIndex: 0,
    })
    assert.deepEqual(resolveSegmentIndexFromBody(multiSegTurn, { segmentIndex: 1 }), {
      kind: 'ok',
      segmentIndex: 1,
    })
  })

  it('errors on out-of-range segmentIndex without receiveId', () => {
    assert.deepEqual(resolveSegmentIndexFromBody(multiSegTurn, { segmentIndex: 9 }), {
      kind: 'error',
      code: 'invalid_segment_index',
    })
  })

  it('resolves receiveId to segment index', () => {
    assert.deepEqual(
      resolveSegmentIndexFromBody(multiSegTurn, { receiveId: 'recv-a' }),
      { kind: 'ok', segmentIndex: 0 },
    )
    assert.deepEqual(
      resolveSegmentIndexFromBody(multiSegTurn, { receiveId: 'recv-b' }),
      { kind: 'ok', segmentIndex: 1 },
    )
  })

  it('prefers in-range segmentIndex over receiveId when both present', () => {
    assert.deepEqual(
      resolveSegmentIndexFromBody(multiSegTurn, {
        segmentIndex: 1,
        receiveId: 'recv-a',
      }),
      { kind: 'ok', segmentIndex: 1 },
    )
  })

  it('falls back to receiveId when segmentIndex out of range', () => {
    assert.deepEqual(
      resolveSegmentIndexFromBody(multiSegTurn, {
        segmentIndex: 9,
        receiveId: 'recv-a',
      }),
      { kind: 'ok', segmentIndex: 0 },
    )
  })

  it('defaults when body omits segment anchor', () => {
    assert.deepEqual(resolveSegmentIndexFromBody(multiSegTurn, {}), {
      kind: 'default',
    })
  })
})

describe('activeSegmentReceive', () => {
  it('defaults to activeSegmentIndex', () => {
    const hit = activeSegmentReceive(multiSegTurn)
    assert.equal(hit?.id, 'recv-b')
    assert.equal(hit?.content, 'Betty')
  })

  it('targets explicit segmentIndex', () => {
    const hit = activeSegmentReceive(multiSegTurn, 0)
    assert.equal(hit?.id, 'recv-a')
    assert.equal(hit?.content, 'Alice')
  })

  it('respects swipe index within segment', () => {
    const turn: HostTurnWithSegments = {
      activeSegmentIndex: 0,
      segments: [
        {
          receives: [
            { id: 'sw0', content: 'v0' },
            { id: 'sw1', content: 'v1' },
          ],
          activeReceiveIndex: 1,
        },
      ],
    }
    const hit = activeSegmentReceive(turn, 0)
    assert.equal(hit?.id, 'sw1')
  })

  it('returns null for out-of-range explicit segmentIndex', () => {
    assert.equal(activeSegmentReceive(multiSegTurn, 9), null)
  })
})

describe('segmentIndexForAction', () => {
  it('maps resolve errors to HTTP status', () => {
    assert.deepEqual(segmentIndexForAction(multiSegTurn, { segmentIndex: 9 }), {
      ok: false,
      code: 'invalid_segment_index',
      status: 400,
    })
    assert.deepEqual(segmentIndexForAction(multiSegTurn, { receiveId: 'missing' }), {
      ok: false,
      code: 'receive_not_found',
      status: 404,
    })
  })

  it('returns segmentIndex when resolved', () => {
    assert.deepEqual(segmentIndexForAction(multiSegTurn, { segmentIndex: 0 }), {
      ok: true,
      segmentIndex: 0,
    })
    assert.deepEqual(segmentIndexForAction(multiSegTurn, {}), { ok: true })
  })
})
