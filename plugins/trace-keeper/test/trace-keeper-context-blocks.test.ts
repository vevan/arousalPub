import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  buildDialogueBlock,
  buildTraceKeeperSeparateBlockSpecs,
  formatTraceKeeperLayoutBlocks,
  TK_BLOCK_DIALOGUE_RAW,
} from '../src/shared/trace-keeper-context-blocks.js'
import { BLOCK_TAG } from '../src/constants.js'

describe('buildTraceKeeperSeparateBlockSpecs', () => {
  it('declares transcript window ending at target with strip on toTurn', () => {
    const specs = buildTraceKeeperSeparateBlockSpecs({
      targetOrdinal: 5,
      windowTurnCount: 3,
    })
    assert.equal(specs.length, 1)
    assert.deepEqual(specs[0], {
      source: 'conversation.transcript',
      blockId: TK_BLOCK_DIALOGUE_RAW,
      fromTurn: 3,
      toTurn: 5,
      tailOrdinal: 5,
      stripBlockTagsOnToTurn: [BLOCK_TAG],
    })
  })

  it('includes target segment index for group chat separate', () => {
    const specs = buildTraceKeeperSeparateBlockSpecs({
      targetOrdinal: 4,
      windowTurnCount: 2,
      targetSegmentIndex: 0,
    })
    assert.equal(specs[0]?.stripBlockTagsOnToTurnSegmentIndex, 0)
  })
})

describe('formatTraceKeeperLayoutBlocks', () => {
  it('wraps resolved transcript in dialogue block', () => {
    const out = formatTraceKeeperLayoutBlocks({
      ok: true,
      blocks: {
        [TK_BLOCK_DIALOGUE_RAW]:
          '<user userName="{{user}}">hi</user>\n<assistant charName="{{char}}">reply</assistant>',
      },
      entriesByBlock: {},
      meta: { userDisplayName: 'U', assistantDisplayName: 'A' },
    })
    assert.match(out.dialogue ?? '', /^<dialogue>/)
    assert.match(out.dialogue ?? '', /hi/)
  })

  it('returns empty when transcript blank', () => {
    const out = formatTraceKeeperLayoutBlocks({
      ok: true,
      blocks: { [TK_BLOCK_DIALOGUE_RAW]: '' },
      entriesByBlock: {},
      meta: { userDisplayName: 'U', assistantDisplayName: 'A' },
    })
    assert.deepEqual(out, {})
  })
})

describe('buildDialogueBlock', () => {
  it('trims and wraps non-empty body', () => {
    assert.equal(buildDialogueBlock('  x  '), '<dialogue>\nx\n</dialogue>')
  })
})
