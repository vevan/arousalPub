import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { patchRegenSegments } from '../../src/utils/regen-turn-segments.js'

describe('patchRegenSegments', () => {
  const receive = {
    id: 'r-new',
    content: 'new',
  }

  const baseSeg = (id: string, speaker: string) => ({
    id,
    speakerCharacterId: speaker,
    receives: [{ id: `r-${id}`, content: 'x' }],
    activeReceiveIndex: 0,
  })

  it('appends receive on last segment without truncation', () => {
    const segments = [baseSeg('s1', 'alice-id')]
    const out = patchRegenSegments(segments, 0, receive)
    assert.equal(out.length, 1)
    assert.equal(out[0]!.receives.length, 2)
    assert.equal(out[0]!.activeReceiveIndex, 1)
    assert.equal(out[0]!.receives[1]!.id, 'r-new')
  })

  it('truncates later segments when regen non-last segment', () => {
    const segments = [
      baseSeg('s1', 'alice-id'),
      baseSeg('s2', 'betty-id'),
      baseSeg('s3', 'charlie-id'),
    ]
    const out = patchRegenSegments(segments, 0, receive)
    assert.equal(out.length, 1)
    assert.equal(out[0]!.receives.length, 2)
  })

  it('returns original when segIdx out of range', () => {
    const segments = [baseSeg('s1', 'alice-id')]
    const out = patchRegenSegments(segments, 2, receive)
    assert.equal(out, segments)
  })
})
