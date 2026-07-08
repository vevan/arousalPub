import assert from 'node:assert/strict'
import { after, before, describe, it } from 'node:test'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

describe('resolvePluginCaptureDebug', () => {
  let prevDataDir: string | undefined
  let prevTestUser: string | undefined
  let tmp: string
  let resolvePluginCaptureDebug: typeof import('../src/plugin-audit-gate.js').resolvePluginCaptureDebug
  const TEST_USER = '00000000'
  const CONV = 'a1b2c3d4'

  before(async () => {
    prevDataDir = process.env.DATA_DIR
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    tmp = path.join(process.cwd(), '.tmp', 'plugin-audit-gate-test')
    await rm(tmp, { recursive: true, force: true })
    process.env.DATA_DIR = tmp
    process.env.AROUSAL_TEST_USER_ID = TEST_USER
    await mkdir(path.join(tmp, TEST_USER, 'chats', CONV), { recursive: true })
    ;({ resolvePluginCaptureDebug } = await import('../src/plugin-audit-gate.js'))
  })

  after(async () => {
    await rm(tmp, { recursive: true, force: true })
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
  })

  it('returns false when not requested', async () => {
    assert.equal(await resolvePluginCaptureDebug(CONV, false), false)
    assert.equal(await resolvePluginCaptureDebug(CONV), false)
  })

  it('returns false when auditDebug disabled', async () => {
    await writeFile(
      path.join(tmp, TEST_USER, 'chats', CONV, 'index.json'),
      JSON.stringify({
        title: 't',
        auditDebug: { enabled: false, maxStored: 10 },
      }),
      'utf8',
    )
    assert.equal(await resolvePluginCaptureDebug(CONV, true), false)
  })

  it('returns true when auditDebug enabled and maxStored >= 1', async () => {
    await writeFile(
      path.join(tmp, TEST_USER, 'chats', CONV, 'index.json'),
      JSON.stringify({
        title: 't',
        auditDebug: { enabled: true, maxStored: 5 },
      }),
      'utf8',
    )
    assert.equal(await resolvePluginCaptureDebug(CONV, true), true)
  })

  it('returns false when maxStored is 0', async () => {
    await writeFile(
      path.join(tmp, TEST_USER, 'chats', CONV, 'index.json'),
      JSON.stringify({
        title: 't',
        auditDebug: { enabled: true, maxStored: 0 },
      }),
      'utf8',
    )
    assert.equal(await resolvePluginCaptureDebug(CONV, true), false)
  })
})
