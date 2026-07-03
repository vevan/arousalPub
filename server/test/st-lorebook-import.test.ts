import assert from 'node:assert/strict'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import {
  convertStLorebookToLorebook,
  isStLorebookJson,
  previewStLorebookImport,
  ST_LOREBOOK_GROUP_ID,
  ST_LOREBOOK_IMPORT_MAX_ENTRIES,
} from '../src/st-lorebook-import.js'

const TEST_USER = 'b0000001'
const FIXTURE_PATH = path.join(
  process.cwd(),
  '..',
  '.tmp',
  '希斯.json',
)

describe('st-lorebook-import', () => {
  let tmp: string | undefined
  let prevDataDir: string | undefined
  let prevTestUser: string | undefined

  before(async () => {
    const os = await import('node:os')
    const { mkdtemp } = await import('node:fs/promises')
    tmp = await mkdtemp(path.join(os.tmpdir(), 'st-lorebook-import-'))
    prevDataDir = process.env.DATA_DIR
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    process.env.DATA_DIR = tmp
    process.env.AROUSAL_TEST_USER_ID = TEST_USER
    await mkdir(path.join(tmp, TEST_USER, 'lorebooks'), { recursive: true })
  })

  after(async () => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
    if (tmp) {
      const { rm } = await import('node:fs/promises')
      await rm(tmp, { recursive: true, force: true })
    }
  })
  it('detects ST lorebook JSON', async () => {
    const raw = JSON.parse(await readFile(FIXTURE_PATH, 'utf8')) as unknown
    assert.equal(isStLorebookJson(raw), true)
    assert.equal(isStLorebookJson({ entries: [] }), false)
    assert.equal(isStLorebookJson({ entries: { 1: null } }), false)
  })

  it('preview 希斯.json: 8 entries, disable/vector mapping', async () => {
    const st = JSON.parse(await readFile(FIXTURE_PATH, 'utf8')) as Parameters<
      typeof previewStLorebookImport
    >[0]
    const preview = previewStLorebookImport(st)
    assert.equal(preview.entryCount, 8)
    assert.equal(preview.disabledCount, 1)
    assert.equal(preview.vectorEntryCount, 2)
    assert.ok(preview.warnings.some((w) => w.includes('stlo')))
  })

  it('convert maps comment→title, disable→enabled, vector trigger', async () => {
    const st = JSON.parse(await readFile(FIXTURE_PATH, 'utf8')) as Parameters<
      typeof convertStLorebookToLorebook
    >[0]
    const lb = await convertStLorebookToLorebook(st, {
      lorebookId: 'lore-st-test01',
      name: '希斯 ST',
    })
    assert.equal(lb.id, 'lore-st-test01')
    assert.equal(lb.entries.length, 8)
    assert.equal(lb.groups.length, 1)
    assert.equal(lb.groups[0]!.id, ST_LOREBOOK_GROUP_ID)
    assert.ok(lb.entries.every((e) => e.groupId === ST_LOREBOOK_GROUP_ID))

    const kaiEr = lb.entries.find((e) => e.title === '凯尔镇')
    assert.ok(kaiEr)
    assert.equal(kaiEr.triggerMode, 'vector')
    assert.equal(kaiEr.enabled, true)

    const keyword = lb.entries.find((e) =>
      e.keys.some((k) => k.includes('Bondage Valley')),
    )
    assert.ok(keyword)
    assert.equal(keyword.triggerMode, 'keyword')

    const disabled = lb.entries.filter((e) => !e.enabled)
    assert.equal(disabled.length, 1)
  })

  it('rejects oversized ST lorebooks', async () => {
    const entries = Object.fromEntries(
      Array.from({ length: ST_LOREBOOK_IMPORT_MAX_ENTRIES + 1 }, (_, i) => [
        String(i),
        { uid: i, key: [`k${i}`], content: `content ${i}` },
      ]),
    )
    await assert.rejects(
      () =>
        convertStLorebookToLorebook(
          { entries },
          { lorebookId: 'lore-st-too-large', name: 'too large' },
        ),
      /超过导入上限/,
    )
  })
})
