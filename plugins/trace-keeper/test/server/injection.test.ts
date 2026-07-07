import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  DEFAULT_TRACE_BUNDLE,
  resolveTraceBundle,
  buildTrackerSystemPrompt,
  resolveAfterAssemblePromptsAddition,
} from '../../dist/server.mjs'

describe('resolveTraceBundle sampleState', () => {
  it('uses embedded sample when custom bundle has empty sampleStateJson', () => {
    const bundle = resolveTraceBundle({
      userSettings: {
        activeBundleId: 'custom-bundle',
        bundleList: [
          {
            id: 'custom-bundle',
            label: 'Mine',
            sampleStateJson: '',
          },
        ],
      },
    })
    assert.deepEqual(bundle.sampleState, DEFAULT_TRACE_BUNDLE.sampleState)
    assert.equal(bundle.sampleStatePromptText, undefined)
  })

  it('uses embedded sample when invalid json and validation enabled', () => {
    const bundle = resolveTraceBundle({
      userSettings: {
        validateSampleStateJson: true,
        activeBundleId: 'custom-bundle',
        bundleList: [
          {
            id: 'custom-bundle',
            label: 'Mine',
            sampleStateJson: '{not valid json',
          },
        ],
      },
    })
    assert.deepEqual(bundle.sampleState, DEFAULT_TRACE_BUNDLE.sampleState)
    assert.equal(bundle.sampleStatePromptText, undefined)
    assert.match(buildTrackerSystemPrompt(bundle), /"scene"/)
  })

  it('injects raw sampleStateJson when invalid and validation disabled', () => {
    const raw = '{not valid json'
    const bundle = resolveTraceBundle({
      userSettings: {
        validateSampleStateJson: false,
        activeBundleId: 'custom-bundle',
        bundleList: [
          {
            id: 'custom-bundle',
            label: 'Mine',
            sampleStateJson: raw,
          },
        ],
      },
    })
    assert.equal(bundle.sampleStatePromptText, raw)
    const prompt = buildTrackerSystemPrompt(bundle)
    assert.ok(prompt.includes(raw))
    assert.doesNotMatch(prompt, /"scene":/)
  })

  it('uses parsed sampleStateJson when valid', () => {
    const bundle = resolveTraceBundle({
      userSettings: {
        activeBundleId: 'custom-bundle',
        bundleList: [
          {
            id: 'custom-bundle',
            label: 'Mine',
            sampleStateJson: '{"mood":"happy"}',
          },
        ],
      },
    })
    assert.deepEqual(bundle.sampleState, { mood: 'happy' })
    assert.equal(bundle.sampleStatePromptText, undefined)
  })
})

describe('trace-keeper injection vs body.plugins', () => {
  it('injects tracker system regardless of unrelated plugin payloads in ctx.plugins', async () => {
    const api = {
      getUserPluginSettings: async () => ({}),
      getConversationPluginSettings: async () => ({}),
      readConversationTurnsTail: async () => [],
    }
    const addition = await resolveAfterAssemblePromptsAddition(
      {
        pluginId: 'trace-keeper',
        macroContext: { conversationId: 'c1' },
        plugins: {
          'some-other-plugin': { foo: 'bar' },
        },
      },
      api,
    )
    assert.ok(addition?.length === 1)
    assert.equal(addition![0]!.position.kind, 'chat')
    assert.equal(addition![0]!.position.depth, 0)
    assert.equal(addition![0]!.position.injectionOrder, 500)
    assert.match(addition![0]!.content, /ex-trace-keeper/i)
  })
})
