import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { PluginContextBlocksSuccess } from '../../../shared/plugin-context-blocks.js'
import {
  formatPlotSummaryLayoutBlocks,
  PS_BLOCK_HISTORY_RAW,
  PS_BLOCK_PREV,
  PS_BLOCK_SIDECARS,
} from '../src/shared/plot-summary-context-blocks.js'

describe('formatPlotSummaryLayoutBlocks', () => {
  it('maps resolved blocks to reference and history layout keys', () => {
    const resolved: PluginContextBlocksSuccess = {
      ok: true,
      blocks: {
        [PS_BLOCK_HISTORY_RAW]: '<user>hi</user>',
      },
      entriesByBlock: {
        [PS_BLOCK_PREV]: [{ id: 'e1', title: 'T1', content: 'old plot' }],
        [PS_BLOCK_SIDECARS]: [],
      },
      meta: {
        userDisplayName: 'User',
        assistantDisplayName: 'Bot',
      },
    }
    const out = formatPlotSummaryLayoutBlocks(resolved)
    assert.match(out.reference ?? '', /previous-summaries/)
    assert.match(out.reference ?? '', /old plot/)
    assert.match(out.history ?? '', /<history>/)
    assert.match(out.history ?? '', /hi/)
  })

  it('returns empty reference when no prior summaries or sidecars', () => {
    const resolved: PluginContextBlocksSuccess = {
      ok: true,
      blocks: { [PS_BLOCK_HISTORY_RAW]: 'turn text' },
      entriesByBlock: {
        [PS_BLOCK_PREV]: [],
        [PS_BLOCK_SIDECARS]: [],
      },
      meta: {
        userDisplayName: 'User',
        assistantDisplayName: 'Bot',
      },
    }
    const out = formatPlotSummaryLayoutBlocks(resolved)
    assert.equal(out.reference, '')
    assert.match(out.history ?? '', /turn text/)
  })
})
