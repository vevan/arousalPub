import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import type { TraceBundle } from './constants.js'
import { resolvePanelView } from './panel-empty.js'

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

describe('resolvePanelView', () => {
  it('empty_session when no turns', () => {
    const r = resolvePanelView(bundle, [], epoch, null)
    assert.equal(r.kind, 'empty')
    if (r.kind === 'empty') {
      assert.equal(r.reason, 'empty_session')
      assert.equal(r.canRegenerate, false)
    }
  })

  it('current turn no_block when assistant has no trace tag', () => {
    const r = resolvePanelView(
      bundle,
      [
        {
          turnOrdinal: 1,
          receives: [{ id: 'r1', content: 'plain reply' }],
          plugins: [],
        },
      ],
      epoch,
      null,
    )
    assert.equal(r.kind, 'empty')
    if (r.kind === 'empty') {
      assert.equal(r.reason, 'no_block')
      assert.equal(r.canRegenerate, true)
    }
  })

  it('current turn awaiting_reply while model is generating', () => {
    const r = resolvePanelView(
      bundle,
      [
        {
          turnOrdinal: 1,
          receives: [{ id: 'r1', content: 'plain reply' }],
          plugins: [],
        },
      ],
      epoch,
      null,
      true,
    )
    assert.equal(r.kind, 'empty')
    if (r.kind === 'empty') {
      assert.equal(r.reason, 'awaiting_reply')
      assert.equal(r.canRegenerate, false)
    }
  })

  it('history turn uses no_data_history without parse detail', () => {
    const r = resolvePanelView(
      bundle,
      [
        {
          turnOrdinal: 1,
          receives: [{ id: 'r1', content: '{bad}' }],
          plugins: [],
        },
        {
          turnOrdinal: 2,
          receives: [{ id: 'r2', content: 'ok' }],
          plugins: [
            {
              pluginId: 'trace-keeper',
              payload: { state: { mood: 'x' }, epoch: 0, receiveId: 'r2' },
            },
          ],
        },
      ],
      epoch,
      1,
    )
    assert.equal(r.kind, 'empty')
    if (r.kind === 'empty') {
      assert.equal(r.reason, 'no_data_history')
      assert.equal(r.canRegenerate, false)
    }
  })

  it('renders content when snapshot exists', () => {
    const r = resolvePanelView(
      bundle,
      [
        {
          turnOrdinal: 1,
          receives: [{ id: 'r1', content: '' }],
          plugins: [
            {
              pluginId: 'trace-keeper',
              payload: {
                state: { scene: { location: 'A', time: 't', weather: 'w' }, mood: 'm' },
                epoch: 0,
                receiveId: 'r1',
              },
            },
          ],
        },
      ],
      epoch,
      null,
    )
    assert.equal(r.kind, 'content')
    if (r.kind === 'content') {
      assert.match(r.html, /A/)
    }
  })

  it('snapshot_missing when assistant json ok but plugins empty', () => {
    const r = resolvePanelView(
      bundle,
      [
        {
          turnOrdinal: 1,
          receives: [
            {
              id: 'r1',
              content: 'x<ex-trace-keeper>{"mood":"ok"}</ex-trace-keeper>',
            },
          ],
          plugins: [],
        },
      ],
      epoch,
      null,
    )
    assert.equal(r.kind, 'empty')
    if (r.kind === 'empty') {
      assert.equal(r.reason, 'snapshot_missing')
    }
  })

  it('render_failed on broken template syntax', () => {
    const badBundle = {
      ...bundle,
      template: '{{#each data',
    }
    const r = resolvePanelView(
      badBundle,
      [
        {
          turnOrdinal: 1,
          receives: [{ id: 'r1', content: '' }],
          plugins: [
            {
              pluginId: 'trace-keeper',
              payload: { state: { mood: 'x' }, epoch: 0, receiveId: 'r1' },
            },
          ],
        },
      ],
      epoch,
      null,
    )
    assert.equal(r.kind, 'empty')
    if (r.kind === 'empty') {
      assert.equal(r.reason, 'render_failed')
      assert.equal(r.canRegenerate, true)
    }
  })
})
