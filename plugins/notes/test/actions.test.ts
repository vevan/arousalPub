import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  parseNotesStore,
  saveNote,
  stripDataPluginAttrs,
} from '../src/server/actions.js'
import type { PluginDataApi } from '../../../server/src/plugin-system/types.js'

function memoryData(initial: Record<string, string | null> = {}): PluginDataApi {
  const files = new Map<string, string>(
    Object.entries(initial).filter((e): e is [string, string] => e[1] != null),
  )
  const keyOf = (scope: string, rel: string, cid?: string) =>
    `${scope}:${cid ?? ''}:${rel}`
  return {
    async list() {
      return [...files.keys()]
    },
    async read(scope, relPath, conversationId) {
      return files.get(keyOf(scope, relPath, conversationId)) ?? null
    },
    async write(scope, relPath, content, conversationId) {
      files.set(keyOf(scope, relPath, conversationId), content)
    },
    async delete(scope, relPath, conversationId) {
      files.delete(keyOf(scope, relPath, conversationId))
    },
  }
}

describe('parseNotesStore', () => {
  it('returns empty store for missing or blank', () => {
    assert.deepEqual(parseNotesStore(null), { version: 1, notes: [] })
    assert.deepEqual(parseNotesStore(''), { version: 1, notes: [] })
    assert.deepEqual(parseNotesStore('  '), { version: 1, notes: [] })
  })

  it('accepts valid v1 store', () => {
    const raw = JSON.stringify({
      version: 1,
      notes: [
        {
          id: 'a',
          title: 't',
          body: 'b',
          createdAt: 1,
          updatedAt: 2,
        },
      ],
    })
    const store = parseNotesStore(raw)
    assert.equal(store.notes.length, 1)
    assert.equal(store.notes[0]!.id, 'a')
  })

  it('fails closed on corrupt or invalid JSON', () => {
    assert.throws(
      () => parseNotesStore('{'),
      (e: Error & { status?: number }) =>
        e.message === 'notes_store_corrupt' && e.status === 500,
    )
    assert.throws(
      () => parseNotesStore('{"version":2,"notes":[]}'),
      (e: Error & { status?: number }) =>
        e.message === 'notes_store_invalid' && e.status === 500,
    )
    assert.throws(
      () => parseNotesStore('{"version":1,"notes":"nope"}'),
      (e: Error & { status?: number }) =>
        e.message === 'notes_store_invalid' && e.status === 500,
    )
  })

  it('strips data-plugin attrs and drops invalid entries on read', () => {
    const raw = JSON.stringify({
      version: 1,
      notes: [
        {
          id: 'a',
          title: 't data-plugin-action="x"',
          body: '<b data-plugin-field="y">ok</b>',
          createdAt: 1,
          updatedAt: 2,
        },
        { id: '', title: 'bad', body: '', createdAt: 1, updatedAt: 1 },
        { notANote: true },
      ],
    })
    const store = parseNotesStore(raw)
    assert.equal(store.notes.length, 1)
    assert.equal(store.notes[0]!.title.includes('data-plugin'), false)
    assert.equal(store.notes[0]!.body.includes('data-plugin'), false)
    assert.equal(store.notes[0]!.body.includes('<b'), true)
  })
})

describe('stripDataPluginAttrs', () => {
  it('removes data-plugin-* attributes from pasted HTML', () => {
    const raw =
      'hello <button data-plugin-action="delete:x" data-plugin-field="y">x</button>'
    const out = stripDataPluginAttrs(raw)
    assert.equal(out.includes('data-plugin-'), false)
    assert.equal(out.includes('<button'), true)
  })

  it('leaves normal markdown alone', () => {
    const md = '- [ ] todo\n**bold**'
    assert.equal(stripDataPluginAttrs(md), md)
  })
})

describe('saveNote', () => {
  it('rejects conversation scope without conversationId', async () => {
    await assert.rejects(
      () =>
        saveNote(
          {
            scope: 'conversation',
            note: { title: 't', body: 'b' },
          },
          memoryData(),
        ),
      (e: Error & { status?: number }) =>
        e.message === 'missing_conversation_id' && e.status === 400,
    )
  })

  it('strips data-plugin attrs on save', async () => {
    const data = memoryData({
      'global::notes.json': JSON.stringify({ version: 1, notes: [] }),
    })
    const { note } = await saveNote(
      {
        scope: 'global',
        note: {
          title: 'x',
          body: '<span data-plugin-action="delete:1">hi</span>',
        },
      },
      data,
    )
    assert.equal(note.body.includes('data-plugin'), false)
    assert.equal(note.body.includes('<span'), true)
  })
})
