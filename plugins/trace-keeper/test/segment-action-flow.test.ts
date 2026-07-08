import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { activeSegmentReceive } from '../src/host-segment-snapshot.js'
import {
  stripTraceKeeperBlocks,
  upsertTraceKeeperBlockInAssistant,
} from '../src/parse-block.js'

const multiSegTurn = {
  activeSegmentIndex: 1,
  segments: [
    {
      receives: [{ id: 'recv-a', content: 'Alice says hi' }],
      activeReceiveIndex: 0,
    },
    {
      receives: [{ id: 'recv-b', content: 'Betty says hey' }],
      activeReceiveIndex: 0,
    },
  ],
}

describe('segment-scoped patch / separate prerequisites', () => {
  it('upserts trace block on targeted segment only', () => {
    const receive = activeSegmentReceive(multiSegTurn, 0)
    assert.ok(receive)
    const next = upsertTraceKeeperBlockInAssistant(receive.content, {
      mood: 'calm',
      scene: { location: 'A', time: 't', weather: 'w' },
    })
    assert.match(next, /ex-trace-keeper/)
    assert.match(next, /Alice says hi/)
    const other = activeSegmentReceive(multiSegTurn, 1)
    assert.equal(other?.content, 'Betty says hey')
  })

  it('separate requires non-empty stripped body on chosen segment', () => {
    const empty = activeSegmentReceive(
      {
        ...multiSegTurn,
        segments: [
          { receives: [{ id: 'recv-a', content: '   ' }], activeReceiveIndex: 0 },
          multiSegTurn.segments[1]!,
        ],
      },
      0,
    )
    assert.equal(stripTraceKeeperBlocks(empty!.content), '')

    const ok = activeSegmentReceive(multiSegTurn, 0)
    assert.equal(stripTraceKeeperBlocks(ok!.content), 'Alice says hi')
  })
})
