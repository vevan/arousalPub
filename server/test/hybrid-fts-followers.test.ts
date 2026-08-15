import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { HybridFtsSettings } from '../src/hybrid-fts-settings.js'

const TEST_USER = 'b0f75001'
const previousSpec: HybridFtsSettings = {
  profile: 'zh-jieba',
  dictVariant: 'default',
}
const nextSpec: HybridFtsSettings = {
  profile: 'lindera',
  dictVariant: 'ipadic',
}

describe('scheduleHybridFtsFollowerRebuilds', () => {
  let tmp = ''
  let prevDataDir: string | undefined
  let prevTestUser: string | undefined
  let scheduleHybridFtsFollowerRebuilds: typeof import('../src/hybrid-fts-followers.js').scheduleHybridFtsFollowerRebuilds
  let runRequestUserAsync: typeof import('../src/user-context.js').runRequestUserAsync

  before(async () => {
    const tempRoot = path.resolve('.tmp')
    await mkdir(tempRoot, { recursive: true })
    tmp = await mkdtemp(path.join(tempRoot, 'hybrid-fts-followers-'))
    prevDataDir = process.env.DATA_DIR
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    process.env.DATA_DIR = tmp
    process.env.AROUSAL_TEST_USER_ID = TEST_USER

    await mkdir(path.join(tmp, TEST_USER, 'lorebooks'), { recursive: true })
    await mkdir(path.join(tmp, TEST_USER, 'knowledgeBases'), { recursive: true })

    const followersMod = await import('../src/hybrid-fts-followers.js')
    const userCtx = await import('../src/user-context.js')
    scheduleHybridFtsFollowerRebuilds =
      followersMod.scheduleHybridFtsFollowerRebuilds
    runRequestUserAsync = userCtx.runRequestUserAsync

    const t = '2026-01-01T00:00:00.000Z'
    const followerLb = {
      id: 'follower',
      name: 'follower',
      groups: [{ id: 'group-main', name: 'Main', order: 0 }],
      entries: [],
      createdAt: t,
      updatedAt: t,
    }
    const independentLb = {
      id: 'independent',
      name: 'independent',
      hybridFts: nextSpec,
      groups: [{ id: 'group-main', name: 'Main', order: 0 }],
      entries: [],
      createdAt: t,
      updatedAt: t,
    }
    await writeFile(
      path.join(tmp, TEST_USER, 'lorebooks', 'follower.json'),
      JSON.stringify(followerLb),
      'utf8',
    )
    await writeFile(
      path.join(tmp, TEST_USER, 'lorebooks', 'independent.json'),
      JSON.stringify(independentLb),
      'utf8',
    )
    await writeFile(
      path.join(tmp, TEST_USER, 'lorebooks', 'index.json'),
      JSON.stringify({
        schemaVersion: 1,
        savedAt: t,
        lorebooks: [
          { id: 'follower', name: 'follower', updatedAt: t },
          { id: 'independent', name: 'independent', updatedAt: t },
        ],
      }),
      'utf8',
    )

    await writeFile(
      path.join(tmp, TEST_USER, 'knowledgeBases', 'kb-follower.json'),
      JSON.stringify({
        id: 'kb-follower',
        name: 'kb-follower',
        fileIds: [],
        createdAt: t,
        updatedAt: t,
      }),
      'utf8',
    )
    await writeFile(
      path.join(tmp, TEST_USER, 'knowledgeBases', 'kb-independent.json'),
      JSON.stringify({
        id: 'kb-independent',
        name: 'kb-independent',
        hybridFts: nextSpec,
        fileIds: [],
        createdAt: t,
        updatedAt: t,
      }),
      'utf8',
    )
    await writeFile(
      path.join(tmp, TEST_USER, 'knowledgeBases', 'index.json'),
      JSON.stringify({
        schemaVersion: 1,
        savedAt: t,
        knowledgeBases: [
          { id: 'kb-follower', name: 'kb-follower', updatedAt: t },
          { id: 'kb-independent', name: 'kb-independent', updatedAt: t },
        ],
      }),
      'utf8',
    )
  })

  after(async () => {
    // 等 follower 调度的后台 FTS drain 结束，避免 after 清 env 后刷噪音
    await new Promise((r) => setTimeout(r, 200))
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
    await rm(tmp, { recursive: true, force: true })
  })

  it('returns only assets that inherit global hybridFts', async () => {
    let result!: Awaited<ReturnType<typeof scheduleHybridFtsFollowerRebuilds>>
    await runRequestUserAsync(TEST_USER, async () => {
      result = await scheduleHybridFtsFollowerRebuilds(previousSpec, nextSpec)
    })
    assert.deepEqual(result.lorebookIds.sort(), ['follower'])
    assert.deepEqual(result.knowledgeBaseIds.sort(), ['kb-follower'])
  })

  it('no-ops when global spec is unchanged', async () => {
    let result!: Awaited<ReturnType<typeof scheduleHybridFtsFollowerRebuilds>>
    await runRequestUserAsync(TEST_USER, async () => {
      result = await scheduleHybridFtsFollowerRebuilds(previousSpec, previousSpec)
    })
    assert.deepEqual(result, { lorebookIds: [], knowledgeBaseIds: [] })
  })
})
