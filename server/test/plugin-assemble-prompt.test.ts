import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  assembleResultAfterPreflight,
  runAssemblePluginPrompt,
} from '../src/plugin-assemble-prompt.js'

const TEST_USER = 'b0000001'
let prevTestUser: string | undefined

const FIXTURE_LAYOUT = {
  messages: [
    { role: 'system' as const, content: '{{blocks.reference}}' },
    { role: 'user' as const, content: '{{blocks.history}}' },
    { role: 'system' as const, content: '{{plugin.systemPromptTemplate}}' },
  ],
}

before(() => {
  prevTestUser = process.env.AROUSAL_TEST_USER_ID
  process.env.AROUSAL_TEST_USER_ID = TEST_USER
})

after(() => {
  if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
  else process.env.AROUSAL_TEST_USER_ID = prevTestUser
})

describe('runAssemblePluginPrompt', () => {
  it('skips empty reference slot without macro_expand_failed', async () => {
    const result = await runAssemblePluginPrompt({
      conversationId: 'abcd1234',
      anchorToTurn: 0,
      layout: FIXTURE_LAYOUT,
      blocks: {
        reference: '',
        history: '<history>\nhello\n</history>',
      },
      pluginSettings: { systemPromptTemplate: 'Summarize as JSON.' },
      dryRun: true,
    })
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.messages.length, 2)
    assert.equal(result.messages[0]?.role, 'user')
    assert.match(result.messages[0]?.content ?? '', /hello/)
    assert.equal(result.messages[1]?.role, 'system')
    assert.match(result.messages[1]?.content ?? '', /Summarize/)
  })

  it('requires anchorToTurn', async () => {
    const result = await runAssemblePluginPrompt({
      conversationId: 'abcd1234',
      anchorToTurn: NaN,
      layout: FIXTURE_LAYOUT,
      blocks: { reference: '', history: 'x' },
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'anchor_to_turn_required')
  })
})

describe('assembleResultAfterPreflight', () => {
  const messages = [{ role: 'user' as const, content: 'hi' }]

  it('dryRun keeps messages when context_exceeded', () => {
    const result = assembleResultAfterPreflight(
      messages,
      {
        ok: false,
        promptTokens: 49859,
        budget: 49000,
        code: 'context_exceeded',
      },
      true,
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.messages.length, 1)
    assert.equal(result.preflight?.ok, false)
    assert.equal(result.preflight?.promptTokens, 49859)
    assert.equal(result.preflight?.budget, 49000)
    assert.equal(result.preflight?.code, 'context_exceeded')
  })

  it('non-dryRun hard-fails on context_exceeded without messages', () => {
    const result = assembleResultAfterPreflight(
      messages,
      {
        ok: false,
        promptTokens: 49859,
        budget: 49000,
        code: 'context_exceeded',
      },
      false,
    )
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.code, 'context_exceeded')
    assert.equal(result.promptTokens, 49859)
    assert.equal(result.budget, 49000)
  })

  it('ok preflight returns success payload', () => {
    const result = assembleResultAfterPreflight(
      messages,
      { ok: true, promptTokens: 100, budget: 49000 },
      false,
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.equal(result.preflight?.ok, true)
    assert.equal(result.preflight?.promptTokens, 100)
  })
})
