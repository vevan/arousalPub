import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sliceKnowledgeText } from '../src/knowledge-chunk.js'
import {
  extractKnowledgeText,
  isKnowledgeDocumentSupported,
  KnowledgeTextExtractError,
} from '../src/knowledge-text-extract.js'
import {
  formatKnowledgeXml,
  knowledgeDocumentDisplayName,
} from '../src/knowledge-xml.js'
import {
  normalizeKnowledgeSettings,
  resolveKnowledgeSettings,
} from '../src/knowledge-settings.js'
import { normalizeTrimOrder } from '../src/budget-trim-settings.js'

describe('knowledge chunk + extract', () => {
  it('slices long text with overlap and prefers paragraph breaks', () => {
    const para = 'Alpha paragraph one.\n\n'
    const text = para.repeat(40) + 'Tail end unique.'
    const chunks = sliceKnowledgeText(text, {
      chunkSizeChars: 80,
      chunkOverlapChars: 10,
    })
    assert.ok(chunks.length >= 2)
    assert.ok(chunks.every((c) => c.length > 0))
    assert.ok(chunks.some((c) => c.includes('Tail')))
  })

  it('returns empty for blank text', () => {
    assert.deepEqual(
      sliceKnowledgeText('   \n\n  ', {
        chunkSizeChars: 100,
        chunkOverlapChars: 10,
      }),
      [],
    )
  })

  it('extracts utf8 text and rejects pdf mime', () => {
    const buf = Buffer.from('hello knowledge', 'utf8')
    assert.equal(
      extractKnowledgeText({
        buffer: buf,
        mime: 'text/plain',
        filename: 'a.txt',
      }),
      'hello knowledge',
    )
    assert.equal(isKnowledgeDocumentSupported('application/pdf'), false)
    assert.throws(
      () =>
        extractKnowledgeText({
          buffer: buf,
          mime: 'application/pdf',
          filename: 'a.pdf',
        }),
      (e: unknown) =>
        e instanceof KnowledgeTextExtractError &&
        e.code === 'document_type_unsupported',
    )
  })

  it('formats knowledge xml escaped', () => {
    const xml = formatKnowledgeXml([
      {
        kbName: 'KB <1>',
        fileName: 'a&b.md',
        ordinal: 0,
        text: 'line <x>',
      },
    ])
    assert.match(xml, /<knowledge>/)
    assert.match(xml, /collection="KB &lt;1&gt;"/)
    assert.match(xml, /book="a&amp;b.md"/)
    assert.match(xml, /chapter="0"/)
    assert.match(xml, /line &lt;x&gt;/)
  })

  it('resolves document display name: alias first, else strip extension', () => {
    assert.equal(
      knowledgeDocumentDisplayName('为美好的世界献上祝福.01.txt', '为美好的世界献上祝福 卷一'),
      '为美好的世界献上祝福 卷一',
    )
    assert.equal(
      knowledgeDocumentDisplayName('为美好的世界献上祝福.01.txt'),
      '为美好的世界献上祝福.01',
    )
    assert.equal(knowledgeDocumentDisplayName('README.md', '  '), 'README')
    assert.equal(knowledgeDocumentDisplayName('.gitignore'), '.gitignore')
    assert.equal(knowledgeDocumentDisplayName('noext'), 'noext')
  })

  it('normalizes knowledge settings and clamp overlap', () => {
    const s = normalizeKnowledgeSettings({
      topK: 99,
      chunkSizeChars: 500,
      chunkOverlapChars: 500,
    })
    assert.equal(s.topK, 32)
    assert.ok(s.chunkOverlapChars < s.chunkSizeChars)
    const resolved = resolveKnowledgeSettings(s, { enabled: false, topK: 2 })
    assert.equal(resolved.enabled, false)
    assert.equal(resolved.topK, 2)
  })

  it('upgrades legacy 3-slot trimOrder with knowledge first', () => {
    assert.deepEqual(normalizeTrimOrder(['lore', 'memory', 'history']), [
      'knowledge',
      'lore',
      'memory',
      'history',
    ])
    assert.deepEqual(
      normalizeTrimOrder(['knowledge', 'lore', 'memory', 'history']),
      ['knowledge', 'lore', 'memory', 'history'],
    )
  })
})
