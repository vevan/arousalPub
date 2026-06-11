import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  clearCstDocumentCache,
  getCachedMacroDocument,
} from './document-cache.js'
import { parseMacroDocument } from './parser.js'

describe('CST document cache', () => {
  it('returns the same document instance for identical text', () => {
    clearCstDocumentCache()
    const text = 'Hello {{user}} and {{char}}'
    const a = getCachedMacroDocument(text)
    const b = getCachedMacroDocument(text)
    assert.equal(a, b)
    assert.notEqual(a, parseMacroDocument(text))
  })

  it('clears on demand', () => {
    clearCstDocumentCache()
    const text = '{{noop}}'
    const a = getCachedMacroDocument(text)
    clearCstDocumentCache()
    const b = getCachedMacroDocument(text)
    assert.notEqual(a, b)
    assert.deepEqual(a.nodes, b.nodes)
  })
})
