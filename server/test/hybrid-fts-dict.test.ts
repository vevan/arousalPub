import assert from 'node:assert/strict'
import { rm } from 'node:fs/promises'
import path from 'node:path'
import { describe, it } from 'node:test'
import {
  ensureDictVariantReady,
  hybridFtsDictPath,
  hybridFtsModelHome,
  hybridFtsRoot,
  languageModelHomeForSettings,
  toUserDataRelativePath,
} from '../src/hybrid-fts-dict.js'
import { HYBRID_FTS_SETTINGS_DEFAULTS } from '../src/hybrid-fts-settings.js'

describe('hybridFts paths', () => {
  const userId = 'a1b2c3d4'

  it('model home is profile + variant under hybrid-fts', () => {
    const home = hybridFtsModelHome(userId, 'zh-jieba', 'big')
    assert.match(home, /a1b2c3d4[\\/]hybrid-fts[\\/]zh-jieba[\\/]big$/)
  })

  it('dict path follows Lance jieba/default layout under model home', () => {
    const dict = hybridFtsDictPath(userId, 'zh-jieba', 'default')
    const expected = path.join(
      hybridFtsModelHome(userId, 'zh-jieba', 'default'),
      'jieba',
      'default',
      'dict.txt',
    )
    assert.equal(dict, expected)
  })

  it('lindera model home and config path follow lindera/{kind}', () => {
    const home = hybridFtsModelHome(userId, 'lindera', 'ipadic')
    assert.match(home, /a1b2c3d4[\\/]hybrid-fts[\\/]lindera[\\/]ipadic$/)
    const cfg = hybridFtsDictPath(userId, 'lindera', 'ipadic')
    assert.equal(
      cfg,
      path.join(home, 'lindera', 'ipadic', 'config.yml'),
    )
  })

  it('hybridFtsRoot is under user data dir', () => {
    assert.match(hybridFtsRoot(userId), /a1b2c3d4[\\/]hybrid-fts$/)
  })
})

describe('toUserDataRelativePath', () => {
  const userId = 'b1b2b2b2'

  it('returns posix-style path under user data dir', () => {
    const abs = hybridFtsDictPath(userId, 'zh-jieba', 'small')
    const rel = toUserDataRelativePath(userId, abs)
    assert.equal(rel, 'hybrid-fts/zh-jieba/small/jieba/default/dict.txt')
    assert.ok(!path.isAbsolute(rel))
    assert.ok(!rel.includes(':'))
  })

  it('model home relative path omits user data root', () => {
    const rel = toUserDataRelativePath(
      userId,
      hybridFtsModelHome(userId, 'zh-jieba', 'big'),
    )
    assert.equal(rel, 'hybrid-fts/zh-jieba/big')
  })
})

describe('languageModelHomeForSettings', () => {
  it('returns null for zh-ngram', () => {
    assert.equal(
      languageModelHomeForSettings('00000000', HYBRID_FTS_SETTINGS_DEFAULTS),
      null,
    )
  })

  it('returns variant-scoped absolute model home for zh-jieba', () => {
    const home = languageModelHomeForSettings('a1b2c3d4', {
      profile: 'zh-jieba',
      dictVariant: 'default',
    })
    assert.ok(home)
    assert.match(home!, /hybrid-fts[\\/]zh-jieba[\\/]default$/)
  })

  it('returns lindera kind-scoped model home', () => {
    const home = languageModelHomeForSettings('a1b2c3d4', {
      profile: 'lindera',
      dictVariant: 'ko-dic',
    })
    assert.ok(home)
    assert.match(home!, /hybrid-fts[\\/]lindera[\\/]ko-dic$/)
  })
})

describe('ensureDictVariantReady', () => {
  it('throws when dict is missing', async () => {
    const userId = 'd00df00d'
    await rm(hybridFtsRoot(userId), { recursive: true, force: true })
    await assert.rejects(
      () => ensureDictVariantReady('zh-jieba', 'big', userId),
      (err: Error) => {
        assert.match(err.message, /dict not downloaded/)
        assert.match(err.message, /hybrid-fts\/zh-jieba\/big\/jieba\/default\/dict\.txt/)
        return true
      },
    )
  })
})
