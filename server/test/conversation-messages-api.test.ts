import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const TEST_USER = 'c0000001'

describe('loadConversationMessages query modes', () => {
  let tmp = ''
  let prevDataDir: string | undefined
  let prevTestUser: string | undefined
  let api: typeof import('../src/conversation-messages-api.js')

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'conv-messages-api-'))
    prevDataDir = process.env.DATA_DIR
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    process.env.DATA_DIR = tmp
    process.env.AROUSAL_TEST_USER_ID = TEST_USER
    api = await import('../src/conversation-messages-api.js')
  })

  after(async () => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
    await rm(tmp, { recursive: true, force: true })
  })

  it('rejects conflicting query params', async () => {
    const result = await api.loadConversationMessages('conv-test', {
      tail: '10',
      before: '5',
    })
    assert.equal(result.ok, false)
    if (result.ok) return
    assert.equal(result.error, 'messages_range_invalid')
  })

  it('tail on empty conversation still returns page (not bare turns)', async () => {
    const result = await api.loadConversationMessages(
      'conv-missing-for-empty-tail',
      { tail: '30' },
    )
    assert.equal(result.ok, true)
    if (!result.ok) return
    assert.deepEqual(result.response.turns, [])
    assert.ok(result.response.page)
    assert.equal(result.response.page.hasMoreBefore, false)
    assert.equal(result.response.page.from, 0)
    assert.equal(result.response.page.to, -1)
  })
})
