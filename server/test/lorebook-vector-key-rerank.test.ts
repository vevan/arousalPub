import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lorebookEntryEmbeddingCorpus } from '../src/lorebook-entry-utils.js'
import type { LorebookEntry } from '../src/lorebook-types.js'
import {
  applyVectorKeyScoreBoost,
  countLoreKeyHitsInScan,
  lorebookEntryKeysCorpusAppendix,
  normalizeLoreEntryKeys,
  VECTOR_KEYS_SCORE_BOOST_MAX,
  vectorRerankCandidateLimit,
} from '../src/lorebook-vector-key-rerank.js'
import {
  memoryItemsToScanPlainText,
  turnsToHistoryScanPlainText,
} from '../src/turn-memory-xml.js'
import { testTurn } from './fixtures/turn-record.js'

function entry(
  partial: Partial<LorebookEntry> & Pick<LorebookEntry, 'id'>,
): LorebookEntry {
  return {
    id: partial.id,
    groupId: partial.groupId ?? 'group-main',
    title: partial.title ?? '',
    content: partial.content ?? '',
    enabled: partial.enabled ?? true,
    order: partial.order ?? 0,
    keys: partial.keys ?? [],
    constant: partial.constant ?? false,
    triggerMode: partial.triggerMode ?? 'vector',
    priority: partial.priority ?? 100,
    createdAt: partial.createdAt ?? 't',
    updatedAt: partial.updatedAt ?? 't',
  }
}

describe('lorebookEntryEmbeddingCorpus keys appendix', () => {
  it('appends Keywords line once with low weight', () => {
    const corpus = lorebookEntryEmbeddingCorpus(
      entry({
        id: 'entry-1',
        title: '场景',
        content: '东厢藏了银烛台。',
        keys: ['银烛台', '东厢', '银烛台'],
      }),
    )
    assert.match(corpus, /^场景\n\n东厢藏了银烛台。\n\nKeywords: 银烛台, 东厢$/)
  })

  it('omits appendix when keys empty', () => {
    assert.equal(
      lorebookEntryEmbeddingCorpus(
        entry({ id: 'entry-2', title: 't', content: 'c', keys: [] }),
      ),
      't\n\nc',
    )
  })

  it('does not index keys-only when title and content empty', () => {
    assert.equal(
      lorebookEntryEmbeddingCorpus(
        entry({ id: 'entry-3', title: '', content: '', keys: ['银烛台'] }),
      ),
      '',
    )
  })
})

describe('lorebook-vector-key-rerank', () => {
  it('normalizes and dedupes keys', () => {
    assert.deepEqual(normalizeLoreEntryKeys([' A ', 'a', 'B', '']), ['A', 'B'])
  })

  it('builds appendix', () => {
    assert.equal(lorebookEntryKeysCorpusAppendix(['x']), 'Keywords: x')
    assert.equal(lorebookEntryKeysCorpusAppendix([]), '')
  })

  it('counts case-insensitive hits', () => {
    assert.deepEqual(
      countLoreKeyHitsInScan(['银烛台', '钥匙'], '桌上有银烛台。'),
      { hits: 1, total: 2 },
    )
  })

  it('ignores single-char keys for hit scoring', () => {
    assert.deepEqual(countLoreKeyHitsInScan(['的', '银烛台'], '的银烛台'), {
      hits: 1,
      total: 1,
    })
  })

  it('applies low relative boost', () => {
    const base = 0.05
    const boosted = applyVectorKeyScoreBoost(
      base,
      ['银烛台', '东厢'],
      '银烛台在东厢',
    )
    assert.equal(boosted, base * (1 + VECTOR_KEYS_SCORE_BOOST_MAX))
    assert.equal(
      applyVectorKeyScoreBoost(base, ['银烛台'], '无关文本'),
      base,
    )
  })

  it('caps candidate limit', () => {
    assert.equal(vectorRerankCandidateLimit(5), 15)
    assert.equal(vectorRerankCandidateLimit(30), 64)
  })
})

describe('scan plain text strips plugin blocks', () => {
  const opts = {
    stripPluginBlocks: true,
    stripBlockTags: ['ex-fixture-block'],
  }

  it('strips history scan text', () => {
    const turn = testTurn({
      turnId: 't1',
      turnOrdinal: 0,
      userText: '问',
      receives: [
        {
          id: 'r1',
          content: '答<ex-fixture-block>{"n":1}</ex-fixture-block>尾',
        },
      ],
    })
    const plain = turnsToHistoryScanPlainText([turn], opts)
    assert.match(plain, /问/)
    assert.match(plain, /答/)
    assert.match(plain, /尾/)
    assert.doesNotMatch(plain, /ex-fixture-block/)
    assert.doesNotMatch(plain, /"n"/)
  })

  it('strips memory scan text', () => {
    const turn = testTurn({
      turnId: 't2',
      turnOrdinal: 1,
      userText: 'u',
      receives: [
        {
          id: 'r1',
          content: '正文<ex-fixture-block>noise</ex-fixture-block>',
        },
      ],
    })
    const plain = memoryItemsToScanPlainText([{ turn }], opts)
    assert.match(plain, /正文/)
    assert.doesNotMatch(plain, /noise/)
  })
})
