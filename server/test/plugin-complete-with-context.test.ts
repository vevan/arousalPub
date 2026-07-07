import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import {
  parseCompleteWithContextBody,
  resolveApiConfigIdForCompleteWithContext,
} from '../src/plugin-complete-with-context.js'

const TEST_USER = 'b0000001'
let prevTestUser: string | undefined

before(() => {
  prevTestUser = process.env.AROUSAL_TEST_USER_ID
  process.env.AROUSAL_TEST_USER_ID = TEST_USER
})

after(() => {
  if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
  else process.env.AROUSAL_TEST_USER_ID = prevTestUser
})

describe('resolveApiConfigIdForCompleteWithContext', () => {
  it('returns explicit apiConfigId without plugin binding lookup', async () => {
    const hit = await resolveApiConfigIdForCompleteWithContext(
      {
        conversationId: 'abcd1234',
        apiConfigId: 'preset-a',
      },
      'plot-summary',
    )
    assert.equal(hit.ok, true)
    if (hit.ok) {
      assert.equal(hit.apiConfigId, 'preset-a')
    }
  })

  it('dryRun allows missing apiConfigId when plugin binding unavailable', async () => {
    const hit = await resolveApiConfigIdForCompleteWithContext(
      {
        conversationId: 'abcd1234',
        dryRun: true,
      },
      'nonexistent-plugin-id',
    )
    assert.equal(hit.ok, true)
    if (hit.ok) {
      assert.equal(hit.apiConfigId, undefined)
    }
  })

  it('non-dryRun requires apiConfigId when plugin binding unavailable', async () => {
    const hit = await resolveApiConfigIdForCompleteWithContext(
      {
        conversationId: 'abcd1234',
      },
      '',
    )
    assert.equal(hit.ok, false)
    if (!hit.ok) {
      assert.equal(hit.code, 'api_config_not_found')
    }
  })
})

describe('parseCompleteWithContextBody', () => {
  it('parses fallbackToChat and captureDebug flags', () => {
    const body = parseCompleteWithContextBody({
      conversationId: 'abcd1234',
      anchorToTurn: 2,
      blocks: [
        {
          source: 'conversation.transcript',
          blockId: 'dialogueRaw',
          fromTurn: 1,
          toTurn: 2,
        },
      ],
      layout: { messages: [{ role: 'user', content: '{{blocks.dialogue}}' }] },
      fallbackToChat: true,
      captureDebug: true,
    })
    assert.ok(body)
    assert.equal(body?.fallbackToChat, true)
    assert.equal(body?.captureDebug, true)
  })
})
