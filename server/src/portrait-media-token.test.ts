import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildPortraitImageUrl,
  characterPortraitImageUrl,
  decodePortraitMediaToken,
  encodePortraitMediaToken,
  PORTRAIT_IMAGE_SIZE,
  PORTRAIT_MEDIA_KIND,
  parsePortraitImageSize,
  portraitImageMaxEdge,
} from './shared/portrait-media-token.js'

describe('portrait media token', () => {
  it('round-trips character ref', () => {
    const ref = {
      userId: '00000000',
      imgId: 'a1b2c3d4',
      kind: PORTRAIT_MEDIA_KIND.character,
    }
    const token = encodePortraitMediaToken(ref)
    const decoded = decodePortraitMediaToken(token)
    assert.ok(decoded)
    assert.equal(decoded!.userId, ref.userId)
    assert.equal(decoded.imgId, ref.imgId)
    assert.equal(decoded.kind, ref.kind)
  })

  it('rejects invalid token', () => {
    assert.equal(decodePortraitMediaToken('!!!'), null)
    assert.equal(decodePortraitMediaToken(''), null)
  })

  it('builds public image url with size', () => {
    const url = characterPortraitImageUrl('00000000', 'deadbeef', {
      size: 's',
      cacheBust: 1,
    })!
    assert.match(url, /^\/api\/i\/[A-Za-z0-9_-]+\?size=s&v=1$/)
  })

  it('parses size presets', () => {
    assert.equal(parsePortraitImageSize('xl'), 'xl')
    assert.equal(parsePortraitImageSize('bad'), null)
    assert.equal(portraitImageMaxEdge('m'), PORTRAIT_IMAGE_SIZE.m)
  })

  it('buildPortraitImageUrl without query when no options', () => {
    const url = buildPortraitImageUrl({
      userId: '00000000',
      imgId: '12345678',
      kind: PORTRAIT_MEDIA_KIND.character,
    })
    assert.match(url, /^\/api\/i\/[A-Za-z0-9_-]+$/)
  })
})
