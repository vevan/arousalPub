import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { runAssemblePluginPrompt } from '../src/plugin-assemble-prompt.js'

const TEST_USER = 'b0000001'
let prevTestUser: string | undefined

const HISTORIAN_LAYOUT = {
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
      layout: HISTORIAN_LAYOUT,
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
      layout: HISTORIAN_LAYOUT,
      blocks: { reference: '', history: 'x' },
    })
    assert.equal(result.ok, false)
    if (!result.ok) assert.equal(result.code, 'anchor_to_turn_required')
  })
})
