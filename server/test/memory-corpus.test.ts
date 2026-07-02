import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { TurnRecord } from '../src/chat-storage.js'
import { testTurn } from './fixtures/turn-record.js'
import {
  buildMemoryEmbeddingCorpus,
  fuseEmbeddingVectors,
  stripMemoryCorpusText,
} from '../src/memory-corpus.js'
import { normalizeMemorySettings } from '../src/memory-settings.js'

function turn(partial: Partial<TurnRecord> & Pick<TurnRecord, 'turnId'>): TurnRecord {
  const receives = partial.receives ?? []
  return testTurn({
    turnId: partial.turnId,
    turnOrdinal: partial.turnOrdinal ?? 0,
    userText: partial.send?.userText ?? '',
    receives,
    activeReceiveIndex: partial.activeReceiveIndex ?? 0,
    segments: partial.segments,
    activeSegmentIndex: partial.activeSegmentIndex,
    plugins: partial.plugins,
    speakerCharacterId: partial.speakerCharacterId,
    createdAt: partial.createdAt,
  })
}

describe('stripMemoryCorpusText', () => {
  const opts = {
    stripPluginBlocks: true,
    stripBlockTags: ['ex-trace-keeper', 'route-selector'],
    stripExPrefixElements: false,
  }

  it('strips declared tags by exact name', () => {
    const raw =
      'hello<ex-trace-keeper>{"x":1}</ex-trace-keeper> world'
    assert.equal(stripMemoryCorpusText(raw, opts), 'hello world')
  })

  it('strips user tag without ex- prefix', () => {
    const raw = 'a<route-selector>{"y":2}</route-selector>b'
    assert.equal(stripMemoryCorpusText(raw, opts), 'ab')
  })

  it('does not strip ex-* wildcard when stripExPrefixElements is off', () => {
    const raw = 'a<ex-custom>{"y":2}</ex-custom>b'
    assert.equal(stripMemoryCorpusText(raw, opts), 'a<ex-custom>{"y":2}</ex-custom>b')
  })
})

describe('buildMemoryEmbeddingCorpus', () => {
  it('strips assistant plugin blocks in memory corpus', () => {
    const opts = {
      stripPluginBlocks: true,
      stripBlockTags: ['ex-trace-keeper'],
      stripExPrefixElements: false,
    }
    const corpus = buildMemoryEmbeddingCorpus(
      turn({
        turnId: 't1',
        send: { userText: '牛奶' },
        receives: [
          {
            id: 'r1',
            content:
              '叙事正文<ex-trace-keeper>{"big":"json"}</ex-trace-keeper>',
          },
        ],
      }),
      opts,
    )
    assert.match(corpus, /牛奶/)
    assert.match(corpus, /叙事正文/)
    assert.doesNotMatch(corpus, /ex-trace-keeper/)
    assert.doesNotMatch(corpus, /"big"/)
  })
})

describe('fuseEmbeddingVectors', () => {
  it('normalizes weighted sum', () => {
    const a = [1, 0]
    const b = [0, 1]
    const fused = fuseEmbeddingVectors(a, b, 0.5)
    const norm = Math.hypot(...fused)
    assert.ok(Math.abs(norm - 1) < 1e-6)
    assert.ok(Math.abs(fused[0]! - fused[1]!) < 1e-6)
  })

  it('returns a when weight is 1', () => {
    const a = [3, 4]
    const b = [0, 1]
    const fused = fuseEmbeddingVectors(a, b, 1)
    assert.deepEqual(fused, a)
  })
})

describe('normalizeMemorySettings recall weight', () => {
  it('clamps recallUserWeight to [0,1]', () => {
    const s = normalizeMemorySettings({ recallUserWeight: 2 })
    assert.equal(s.recallUserWeight, 1)
    const s2 = normalizeMemorySettings({ recallUserWeight: -1 })
    assert.equal(s2.recallUserWeight, 0)
  })
})
