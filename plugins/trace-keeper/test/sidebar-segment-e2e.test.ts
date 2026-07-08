import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TraceBundle } from '../src/constants.js'
import { activeSegmentReceive } from '../src/host-segment-snapshot.js'
import { upsertTraceKeeperBlockInAssistant } from '../src/parse-block.js'
import { resolvePanelView } from '../src/panel-empty.js'
import { buildSeparateDialogueMessages } from '../src/separate-dialogue.js'
import {
  getPinnedView,
  setPinnedView,
  type PinnedTraceView,
} from '../src/state.js'

const bundle: TraceBundle = {
  id: 'test',
  label: 'test',
  sampleState: {
    scene: { location: 'X', time: 't', weather: 'w' },
    mood: 'm',
  },
  template:
    '<div class="trace-keeper-panel"><dd>{{data.scene.location}}</dd></div>',
  stylesheet: '',
}
const epoch = 0
const CONV = 'conv-sidebar-e2e'

const multiSegTurn = {
  turnOrdinal: 2,
  activeSegmentIndex: 1,
  segments: [
    {
      speakerCharacterId: 'char-a',
      receives: [{ id: 'recv-a', content: 'Alice says hi' }],
      activeReceiveIndex: 0,
    },
    {
      speakerCharacterId: 'char-b',
      receives: [
        {
          id: 'recv-b',
          content: 'Betty says hey <ex-trace-keeper>{"mood":"m"}</ex-trace-keeper>',
        },
      ],
      activeReceiveIndex: 0,
    },
  ],
  plugins: [
    {
      pluginId: 'trace-keeper',
      payload: {
        state: {
          scene: { location: 'AliceLoc', time: 't', weather: 'w' },
          mood: 'm',
        },
        epoch: 0,
        receiveId: 'recv-a',
      },
    },
    {
      pluginId: 'trace-keeper',
      payload: {
        state: {
          scene: { location: 'BettyLoc', time: 't', weather: 'w' },
          mood: 'm',
        },
        epoch: 0,
        receiveId: 'recv-b',
      },
    },
  ],
}

function shiftPinnedSegmentIndex(
  pinned: PinnedTraceView,
  delta: number,
  segmentCount: number,
): number {
  return Math.min(
    Math.max(0, pinned.segmentIndex + delta),
    Math.max(0, segmentCount - 1),
  )
}

describe('trace-keeper sidebar segment flow (E2E unit)', () => {
  it('live view shows active segment trace; pinned switches segment', () => {
    const live = resolvePanelView(bundle, [multiSegTurn], epoch, null)
    assert.equal(live.kind, 'content')
    if (live.kind === 'content') {
      assert.match(live.html, /BettyLoc/)
      assert.equal(live.segmentIndex, 1)
    }

    const pinned = resolvePanelView(
      bundle,
      [multiSegTurn],
      epoch,
      { turnOrdinal: 2, segmentIndex: 0 },
    )
    assert.equal(pinned.kind, 'content')
    if (pinned.kind === 'content') {
      assert.match(pinned.html, /AliceLoc/)
      assert.equal(pinned.mode, 'pinned')
      assert.equal(pinned.segmentIndex, 0)
    }
  })

  it('segment prev/next clamps within multi-segment turn', () => {
    const pinned: PinnedTraceView = { turnOrdinal: 2, segmentIndex: 0 }
    const count = multiSegTurn.segments.length
    assert.equal(shiftPinnedSegmentIndex(pinned, -1, count), 0)
    assert.equal(shiftPinnedSegmentIndex(pinned, 1, count), 1)
    assert.equal(
      shiftPinnedSegmentIndex({ ...pinned, segmentIndex: 1 }, 1, count),
      1,
    )
  })

  it('pinned state persists per conversation', () => {
    setPinnedView(CONV, { turnOrdinal: 2, segmentIndex: 0 })
    assert.deepEqual(getPinnedView(CONV), { turnOrdinal: 2, segmentIndex: 0 })
    setPinnedView(CONV, null)
    assert.equal(getPinnedView(CONV), null)
  })

  it('patch upserts trace block on targeted segment only', () => {
    const receive = activeSegmentReceive(multiSegTurn, 0)
    assert.ok(receive)
    const nextState = {
      scene: { location: 'PatchedAlice', time: 't', weather: 'w' },
      mood: 'calm',
    }
    const patched = upsertTraceKeeperBlockInAssistant(receive.content, nextState)
    assert.match(patched, /PatchedAlice/)
    assert.match(patched, /Alice says hi/)
    const sibling = activeSegmentReceive(multiSegTurn, 1)
    assert.equal(sibling?.content, multiSegTurn.segments[1]!.receives[0]!.content)
  })

  it('separate dialogue strips block on target segment only', () => {
    const turn = {
      ...multiSegTurn,
      userText: 'group prompt',
    }
    const msgs = buildSeparateDialogueMessages([turn], 2, 1, 0)
    const assistant = msgs
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
    assert.equal(assistant.length, 2)
    assert.equal(assistant[0], 'Alice says hi')
    assert.match(assistant[1]!, /ex-trace-keeper/)
  })
})
