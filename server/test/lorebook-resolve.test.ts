import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import type { Lorebook, LorebookEntry } from '../src/lorebook-types.js'

const TEST_USER = 'b0000002'

function makeEntry(
  partial: Partial<LorebookEntry> & Pick<LorebookEntry, 'id' | 'content'>,
): LorebookEntry {
  const t = '2026-01-01T00:00:00.000Z'
  const triggerMode =
    partial.triggerMode ??
    (partial.constant ? 'constant' : ('keyword' as const))
  return {
    groupId: 'group-main',
    title: partial.title ?? partial.id,
    enabled: true,
    order: 0,
    keys: [],
    constant: triggerMode === 'constant',
    triggerMode,
    priority: 100,
    createdAt: t,
    updatedAt: t,
    ...partial,
  }
}

function makeLorebook(
  id: string,
  name: string,
  entries: LorebookEntry[],
): Lorebook {
  const t = '2026-01-01T00:00:00.000Z'
  return {
    id,
    name,
    groups: [{ id: 'group-main', name: 'Main', order: 0 }],
    entries,
    createdAt: t,
    updatedAt: t,
  }
}

describe('lorebook resolve integration', () => {
  let tmp: string
  let prevDataDir: string | undefined
  let prevTestUser: string | undefined
  let lorebookSeenEntryKey: typeof import('../src/lorebook-resolve.js').lorebookSeenEntryKey
  let resolveLorebookInjectionParts: typeof import('../src/lorebook-resolve.js').resolveLorebookInjectionParts
  let selectLorebookVectorCandidates: typeof import('../src/lorebook-resolve.js').selectLorebookVectorCandidates
  let writeLorebooksDocument: typeof import('../src/lorebook-file.js').writeLorebooksDocument
  let assertValidLorebooksPayload: typeof import('../src/lorebook-file.js').assertValidLorebooksPayload
  let createKnowledgeBase: typeof import('../src/knowledge-base-file.js').createKnowledgeBase
  let patchKnowledgeBase: typeof import('../src/knowledge-base-file.js').patchKnowledgeBase
  let updateGlobalEmbeddingApiSettings: typeof import('../src/user-preferences-file.js').updateGlobalEmbeddingApiSettings

  before(async () => {
    const tempRoot = path.resolve('.tmp')
    await mkdir(tempRoot, { recursive: true })
    tmp = await mkdtemp(path.join(tempRoot, 'lorebook-resolve-'))
    prevDataDir = process.env.DATA_DIR
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    process.env.DATA_DIR = tmp
    process.env.AROUSAL_TEST_USER_ID = TEST_USER
    await mkdir(path.join(tmp, TEST_USER, 'lorebooks'), { recursive: true })

    const resolveMod = await import('../src/lorebook-resolve.js')
    const fileMod = await import('../src/lorebook-file.js')
    const prefsMod = await import('../src/user-preferences-file.js')
    lorebookSeenEntryKey = resolveMod.lorebookSeenEntryKey
    resolveLorebookInjectionParts = resolveMod.resolveLorebookInjectionParts
    selectLorebookVectorCandidates = resolveMod.selectLorebookVectorCandidates
    writeLorebooksDocument = fileMod.writeLorebooksDocument
    assertValidLorebooksPayload = fileMod.assertValidLorebooksPayload
    const knowledgeFileMod = await import('../src/knowledge-base-file.js')
    createKnowledgeBase = knowledgeFileMod.createKnowledgeBase
    patchKnowledgeBase = knowledgeFileMod.patchKnowledgeBase
    updateGlobalEmbeddingApiSettings = prefsMod.updateGlobalEmbeddingApiSettings
  })

  after(async () => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
    await rm(tmp, { recursive: true, force: true })
  })

  const resolveSettings = {
    recursiveEnabled: false,
    maxRecursionDepth: 0,
    keywordTopK: 64,
    vectorEnabled: false,
    vectorTopK: 5,
  }

  it('keeps constant entries when two lorebooks share the same entry id', async () => {
    await writeLorebooksDocument({
      schemaVersion: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      lorebooks: [
        makeLorebook('lore-a', 'Book A', [
          makeEntry({
            id: 'entry-shared',
            title: 'A constant',
            content: 'content from book A',
            constant: true,
            triggerMode: 'constant',
          }),
        ]),
        makeLorebook('lore-b', 'Book B', [
          makeEntry({
            id: 'entry-shared',
            title: 'B constant',
            content: 'content from book B',
            constant: true,
            triggerMode: 'constant',
          }),
        ]),
      ],
    })

    const parts = await resolveLorebookInjectionParts(['lore-a', 'lore-b'], {
      lorebookSettings: resolveSettings,
    })

    assert.equal(parts.constantLore.length, 2)
    assert.deepEqual(
      parts.constantLore.map((item) => ({
        lorebookId: item.lorebookId,
        entryId: item.entry.id,
        content: item.entry.content,
      })),
      [
        {
          lorebookId: 'lore-a',
          entryId: 'entry-shared',
          content: 'content from book A',
        },
        {
          lorebookId: 'lore-b',
          entryId: 'entry-shared',
          content: 'content from book B',
        },
      ],
    )
    assert.equal(parts.matchedLore.length, 0)
  })

  it('keeps keyword matches when two lorebooks share the same entry id', async () => {
    await writeLorebooksDocument({
      schemaVersion: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      lorebooks: [
        makeLorebook('lore-a', 'Book A', [
          makeEntry({
            id: 'entry-shared',
            title: 'A keyword',
            content: 'alpha lore',
            keys: ['alpha'],
            triggerMode: 'keyword',
          }),
        ]),
        makeLorebook('lore-b', 'Book B', [
          makeEntry({
            id: 'entry-shared',
            title: 'B keyword',
            content: 'beta lore',
            keys: ['beta'],
            triggerMode: 'keyword',
          }),
        ]),
      ],
    })

    const parts = await resolveLorebookInjectionParts(['lore-a', 'lore-b'], {
      scanCorpus: 'mentions alpha and beta together',
      lorebookSettings: resolveSettings,
    })

    assert.equal(parts.constantLore.length, 0)
    assert.equal(parts.matchedLore.length, 2)
    assert.deepEqual(
      parts.matchedLore.map((item) => ({
        lorebookId: item.lorebookId,
        entryId: item.entry.id,
        mode: item.mode,
        content: item.entry.content,
      })),
      [
        {
          lorebookId: 'lore-a',
          entryId: 'entry-shared',
          mode: 'keyword',
          content: 'alpha lore',
        },
        {
          lorebookId: 'lore-b',
          entryId: 'entry-shared',
          mode: 'keyword',
          content: 'beta lore',
        },
      ],
    )
  })

  it('does not throw when vector recall is enabled but embedding is unavailable', async () => {
    await updateGlobalEmbeddingApiSettings({
      baseUrl: 'http://127.0.0.1:1/v1',
      apiKey: '',
      apiKeyId: null,
    })
    await writeLorebooksDocument({
      schemaVersion: 1,
      savedAt: '2026-01-01T00:00:00.000Z',
      lorebooks: [
        makeLorebook('lore-a', 'Book A', [
          makeEntry({
            id: 'entry-keyword',
            title: 'Keyword fallback',
            content: 'fallback lore',
            keys: ['fallback'],
            triggerMode: 'keyword',
          }),
          makeEntry({
            id: 'entry-vector',
            title: 'Vector only',
            content: 'vector lore',
            keys: ['vector-key'],
            triggerMode: 'vector',
          }),
        ]),
      ],
    })

    const parts = await resolveLorebookInjectionParts(['lore-a'], {
      scanCorpus: 'please use fallback',
      lorebookSettings: {
        ...resolveSettings,
        vectorEnabled: true,
        vectorTopK: 3,
      },
    })

    assert.equal(parts.constantLore.length, 0)
    assert.equal(parts.matchedLore.length, 1)
    assert.equal(parts.matchedLore[0]!.mode, 'keyword')
    assert.equal(parts.matchedLore[0]!.entry.id, 'entry-keyword')
  })

  describe('lorebookSeenEntryKey', () => {
    it('distinguishes same entry id across lorebooks', () => {
      const a = lorebookSeenEntryKey('lb-a', 'entry-1')
      const b = lorebookSeenEntryKey('lb-b', 'entry-1')
      assert.notEqual(a, b)
    })

    it('keeps key stable for same lorebook and entry', () => {
      const key1 = lorebookSeenEntryKey('lb-a', 'entry-1')
      const key2 = lorebookSeenEntryKey('lb-a', 'entry-1')
      assert.equal(key1, key2)
    })
  })

  it('keeps vector candidates with the same entry id from different books', () => {
    const selected = selectLorebookVectorCandidates(
      [
        {
          lorebookId: 'lore-a',
          entry: makeEntry({
            id: 'entry-shared',
            content: 'A',
            triggerMode: 'vector',
          }),
          baseScore: 0.9,
          scoreKind: 'rrf',
        },
        {
          lorebookId: 'lore-b',
          entry: makeEntry({
            id: 'entry-shared',
            content: 'B',
            triggerMode: 'vector',
          }),
          baseScore: 0.8,
          scoreKind: 'rrf',
        },
      ],
      '',
      2,
    )
    assert.deepEqual(
      selected.map((item) => `${item.lorebookId}:${item.entry.content}`),
      ['lore-a:A', 'lore-b:B'],
    )
  })

  it('strictly validates lorebook hybridFts overrides', () => {
    const valid = makeLorebook('lore-hybrid', 'Hybrid', [])
    valid.hybridFts = { profile: 'en', dictVariant: null }
    assert.equal(
      assertValidLorebooksPayload({ lorebooks: [valid] }).lorebooks[0]!.hybridFts
        ?.profile,
      'en',
    )
    assert.throws(() =>
      assertValidLorebooksPayload({
        lorebooks: [{ ...valid, hybridFts: { profile: 'lindera' } }],
      }),
    )
  })

  it('persists and clears a knowledge-base hybridFts override', async () => {
    const created = await createKnowledgeBase({
      id: 'kb-hybrid-test',
      name: 'Hybrid KB',
      hybridFts: { profile: 'en', dictVariant: null },
    })
    assert.deepEqual(created.hybridFts, { profile: 'en', dictVariant: null })
    const inherited = await patchKnowledgeBase(created.id, { hybridFts: null })
    assert.ok(inherited)
    assert.equal(inherited.hybridFts, undefined)
  })
})
