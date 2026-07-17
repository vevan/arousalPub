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

  it('falls back to sentence-ending punctuation when no newline in window', () => {
    // 无换行长段：每 90 字一个句号，窗口 100，句号在 ≥60% 处 → 应在句号后切
    const sentence = '甲'.repeat(89) + '。'
    const text = sentence.repeat(5)
    const chunks = sliceKnowledgeText(text, {
      chunkSizeChars: 100,
      chunkOverlapChars: 0,
    })
    assert.ok(chunks.length >= 4)
    for (const c of chunks.slice(0, -1)) {
      assert.ok(c.endsWith('。'), `chunk should end at sentence: …${c.slice(-5)}`)
    }
  })

  it('includes trailing closers after sentence ender in the same chunk', () => {
    const corner = '「' + '乙'.repeat(86) + '。」'
    const curly = '“' + '丙'.repeat(86) + '。”'
    for (const [label, sentence, suffix] of [
      ['corner', corner, '。」'],
      ['curly', curly, '。”'],
    ] as const) {
      const chunks = sliceKnowledgeText(sentence.repeat(4), {
        chunkSizeChars: 100,
        chunkOverlapChars: 0,
      })
      assert.ok(chunks.length >= 3, label)
      for (const c of chunks.slice(0, -1)) {
        assert.ok(
          c.endsWith(suffix),
          `${label}: closer should stay with sentence: …${c.slice(-5)}`,
        )
      }
    }
  })

  it('treats ascii period as ender only when followed by whitespace', () => {
    // 「3.14」中的点不应成为切点；后跟空格的句点可以
    const text = ('pi is 3.14159 ok. ' + 'x'.repeat(72)).repeat(4)
    const chunks = sliceKnowledgeText(text, {
      chunkSizeChars: 100,
      chunkOverlapChars: 0,
    })
    for (const c of chunks) {
      assert.ok(!c.startsWith('14159'), 'must not split inside 3.14159')
    }
  })

  it('keeps chunk size and newline breaks accurate with astral characters', () => {
    // 60 个 emoji（增补平面）+ 换行 + 120 个汉字；窗口 100 → 应恰好切在换行处
    const text = '😀'.repeat(60) + '\n' + '辛'.repeat(120)
    const chunks = sliceKnowledgeText(text, {
      chunkSizeChars: 100,
      chunkOverlapChars: 0,
    })
    assert.ok(chunks.length >= 2)
    assert.match(chunks[0]!, /^😀+$/u)
    assert.equal(Array.from(chunks[0]!).length, 60)
    for (const c of chunks) {
      assert.ok(Array.from(c).length <= 100, 'chunk must not exceed size')
    }
  })

  it('hard-cuts at fixed size when no boundary qualifies', () => {
    const text = '丙'.repeat(350)
    const chunks = sliceKnowledgeText(text, {
      chunkSizeChars: 100,
      chunkOverlapChars: 10,
    })
    assert.equal(chunks[0]!.length, 100)
    assert.ok(chunks.every((c) => Array.from(c).length <= 100))
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
