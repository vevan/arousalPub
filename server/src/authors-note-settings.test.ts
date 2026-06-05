import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AUTHORS_NOTE_DEFAULTS,
  authorsNoteForInjection,
  authorsNoteMacroText,
  mergeAuthorsNote,
  normalizeAuthorsNote,
} from './authors-note-settings.js'

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
