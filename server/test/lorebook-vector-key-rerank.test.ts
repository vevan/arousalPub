import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { lorebookEntryEmbeddingCorpus } from '../src/lorebook-entry-utils.js'
import type { LorebookEntry } from '../src/lorebook-types.js'
import {
  applyVectorKeyScoreBoost,
  countLoreKeyHitsInScan,
  lorebookEntryKeysCorpusAppendix,
  normalizeLoreEntryKeys,
  selectTopAfterVectorKeyBoost,
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

  it('caps hitRatio denominator so long key lists still boost', () => {
    const base = 0.05
    const manyKeys = Array.from({ length: 20 }, (_, i) => `kw${String(i).padStart(2, '0')}`)
    manyKeys[0] = '银烛台'
    // 20 keys → denom=3; 1 hit → ratio 1/3
    const oneHit = applyVectorKeyScoreBoost(base, manyKeys, '桌上有银烛台')
    assert.equal(oneHit, base * (1 + VECTOR_KEYS_SCORE_BOOST_MAX / 3))
    const threeHitKeys = ['银烛台', '东厢', '钥匙', ...manyKeys.slice(3)]
    const threeHits = applyVectorKeyScoreBoost(
      base,
      threeHitKeys,
      '银烛台 东厢 钥匙',
    )
    assert.equal(threeHits, base * (1 + VECTOR_KEYS_SCORE_BOOST_MAX))
  })

  it('caps candidate limit', () => {
    assert.equal(vectorRerankCandidateLimit(5), 15)
    assert.equal(vectorRerankCandidateLimit(30), 64)
  })

  it('all single-char keys yield no boost', () => {
    const base = 0.05
    assert.equal(
      applyVectorKeyScoreBoost(base, ['的', '了', '是'], '的了是银烛台'),
      base,
    )
  })

  it('more than three hits still caps at full boost', () => {
    const base = 0.05
    const boosted = applyVectorKeyScoreBoost(
      base,
      ['银烛台', '东厢', '钥匙', '抽屉'],
      '银烛台 东厢 钥匙 抽屉',
    )
    assert.equal(boosted, base * (1 + VECTOR_KEYS_SCORE_BOOST_MAX))
  })

  it('key boost can promote a weaker hybrid hit into TopK', () => {
    const out = selectTopAfterVectorKeyBoost(
      [
        { id: 'strong-near', keys: [], baseScore: 0.05, priority: 100 },
        {
          id: 'keyed-mid',
          keys: ['银烛台'],
          baseScore: 0.045,
          priority: 100,
        },
      ],
      '桌上有银烛台',
      1,
    )
    // 0.045 * 1.12 = 0.0504 > 0.05
    assert.deepEqual(
      out.map((x) => x.id),
      ['keyed-mid'],
    )
  })

  it('without key hits, higher baseScore stays on top', () => {
    const out = selectTopAfterVectorKeyBoost(
      [
        { id: 'strong-near', keys: ['无关词'], baseScore: 0.05, priority: 100 },
        { id: 'keyed-mid', keys: ['银烛台'], baseScore: 0.045, priority: 100 },
      ],
      '完全不沾边的扫描语料',
      1,
    )
    assert.deepEqual(
      out.map((x) => x.id),
      ['strong-near'],
    )
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
