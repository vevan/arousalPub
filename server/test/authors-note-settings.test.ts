import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUTHORS_NOTE_DEFAULTS,
  DEFAULT_AUTHORS_NOTE_TEMPLATE,
  authorsNoteForInjection,
  authorsNoteMacroText,
  defaultAuthorsNoteMacroText,
  mergeAuthorsNote,
  normalizeAuthorsNote,
  normalizeDefaultAuthorsNoteTemplate,
  seedAuthorsNoteFromTemplate,
} from '../src/authors-note-settings.js'

describe('normalizeAuthorsNote', () => {
  it('disables when content empty', () => {
    const r = normalizeAuthorsNote({ enabled: true, content: '   ' })
    assert.equal(r.enabled, false)
    assert.equal(r.content, '')
  })

  it('requires content to stay enabled', () => {
    const r = normalizeAuthorsNote({
      enabled: true,
      content: 'hello',
      injectionDepth: 2,
      role: 'user',
    })
    assert.equal(r.enabled, true)
    assert.equal(r.content, 'hello')
    assert.equal(r.injectionDepth, 2)
    assert.equal(r.role, 'user')
  })
})

describe('mergeAuthorsNote', () => {
  it('clears enabled when content cleared', () => {
    const base = normalizeAuthorsNote({
      enabled: true,
      content: 'note',
    })
    const r = mergeAuthorsNote(base, { content: '' })
    assert.equal(r.enabled, false)
    assert.equal(r.content, '')
  })
})

describe('authorsNoteForInjection', () => {
  it('returns null when disabled', () => {
    assert.equal(
      authorsNoteForInjection({ enabled: false, content: 'x' }),
      null,
    )
  })

  it('returns payload when enabled', () => {
    const inj = authorsNoteForInjection({
      enabled: true,
      content: '  stay in scene  ',
      injectionDepth: 4,
      role: 'system',
    })
    assert.ok(inj)
    assert.equal(inj!.content, 'stay in scene')
  })
})

describe('authorsNoteMacroText', () => {
  it('matches injection content', () => {
    assert.equal(
      authorsNoteMacroText({ enabled: true, content: 'macro body' }),
      'macro body',
    )
    assert.equal(authorsNoteMacroText(AUTHORS_NOTE_DEFAULTS), '')
  })
})

describe('defaultAuthorsNote', () => {
  it('macro returns template content regardless of enabledForNewChats', () => {
    assert.equal(
      defaultAuthorsNoteMacroText({
        content: 'default tpl',
        enabledForNewChats: false,
      }),
      'default tpl',
    )
    assert.equal(defaultAuthorsNoteMacroText(DEFAULT_AUTHORS_NOTE_TEMPLATE), '')
  })

  it('seed copies template into session shape', () => {
    const seeded = seedAuthorsNoteFromTemplate({
      content: 'seed me',
      injectionDepth: 2,
      role: 'user',
      enabledForNewChats: true,
    })
    assert.ok(seeded)
    assert.equal(seeded!.content, 'seed me')
    assert.equal(seeded!.enabled, true)
    assert.equal(seeded!.injectionDepth, 2)
    assert.equal(seeded!.role, 'user')
  })

  it('seed returns null when template empty', () => {
    assert.equal(seedAuthorsNoteFromTemplate({ content: '  ' }), null)
  })

  it('seed respects enabledForNewChats false', () => {
    const seeded = seedAuthorsNoteFromTemplate({
      content: 'x',
      enabledForNewChats: false,
    })
    assert.ok(seeded)
    assert.equal(seeded!.enabled, false)
    assert.equal(authorsNoteForInjection(seeded), null)
  })
})
