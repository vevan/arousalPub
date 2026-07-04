import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const TEST_USER = 'c0000001'

describe('character userCardList', () => {
  let tmp: string
  let prevDataDir: string | undefined
  let prevTestUser: string | undefined
  let charA = ''
  let charB = ''
  let storage: typeof import('../src/character-storage.js')
  let extractCardFromPng: typeof import('../src/character-png.js').extractCardFromPng

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'char-user-card-'))
    prevDataDir = process.env.DATA_DIR
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    process.env.DATA_DIR = tmp
    process.env.AROUSAL_TEST_USER_ID = TEST_USER
    await mkdir(path.join(tmp, TEST_USER, 'characters'), { recursive: true })

    storage = await import('../src/character-storage.js')
    ;({ extractCardFromPng } = await import('../src/character-png.js'))

    const docA = await storage.importCharacterCard(
      storage.cardFromNewCharacterForm({ name: 'Alpha AI' }),
    )
    const docB = await storage.importCharacterCard(
      storage.cardFromNewCharacterForm({ name: 'Beta User' }),
    )
    charA = docA.id
    charB = docB.id
    assert.equal(await storage.updateCharacterUserMark(charB, true), true)
  })

  after(async () => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
    await rm(tmp, { recursive: true, force: true })
  })

  it('lists isUser and filters by kind', async () => {
    const defaultList = await storage.listCharacterSummaries({
      offset: 0,
      limit: 50,
    })
    assert.equal(defaultList.total, 1)
    assert.equal(defaultList.items[0]?.id, charA)

    const all = await storage.listCharacterSummaries({
      offset: 0,
      limit: 50,
      kind: 'all',
    })
    assert.equal(all.total, 2)
    assert.equal(all.filterCounts.kindUser, 1)
    assert.equal(all.filterCounts.kindNotUser, 1)

    const users = await storage.listCharacterSummaries({
      offset: 0,
      limit: 50,
      kind: 'user',
    })
    assert.equal(users.total, 1)
    assert.equal(users.items[0]?.id, charB)
    assert.equal(users.items[0]?.isUser, true)

    const notUsers = await storage.listCharacterSummaries({
      offset: 0,
      limit: 50,
      kind: 'notUser',
    })
    assert.equal(notUsers.total, 1)
    assert.equal(notUsers.items[0]?.id, charA)
    assert.equal(notUsers.items[0]?.isUser, false)
  })

  it('PATCH isUser updates index only, not PNG card payload', async () => {
    const doc = await storage.patchCharacterDocument(charA, { isUser: true })
    assert.ok(doc)
    assert.equal(doc.isUser, true)

    const png = await readFile(
      path.join(tmp, TEST_USER, 'characters', `${charA}.png`),
    )
    const card = extractCardFromPng(png)
    assert.equal('isUser' in card, false)
  })

  it('delete and rebuild prune userCardList', async () => {
    assert.equal(await storage.deleteCharacterFile(charB), true)

    const idxPath = path.join(tmp, TEST_USER, 'characters', 'index.json')
    const beforeRebuild = JSON.parse(await readFile(idxPath, 'utf8')) as {
      userCardList?: string[]
    }
    assert.ok(!beforeRebuild.userCardList?.includes(charB))

    await storage.rebuildCharacterIndexFromDisk()
    const afterRebuild = JSON.parse(await readFile(idxPath, 'utf8')) as {
      userCardList?: string[]
      entries: { id: string }[]
    }
    assert.ok(!afterRebuild.userCardList?.includes(charB))
    assert.equal(afterRebuild.entries.some((e) => e.id === charA), true)
    assert.equal(afterRebuild.userCardList?.includes(charA), true)
  })
})
