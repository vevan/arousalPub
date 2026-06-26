import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { describe, it } from 'node:test'
import { getUserDataDir } from '../src/config.js'
import {
  ensureDictVariantReady,
  hybridFtsDictPath,
  hybridFtsModelHome,
  hybridFtsRoot,
  isDictVariantDownloaded,
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
})

describe('legacy dict migration', () => {
  const userId = 'c0ffee00'

  it('migrates lance-language-models/jieba/variants layout on read', async () => {
    const legacy = path.join(
      getUserDataDir(userId),
      'lance-language-models',
      'jieba',
      'variants',
      'small',
      'dict.txt',
    )
    const migrated = hybridFtsDictPath(userId, 'zh-jieba', 'small')
    await mkdir(path.dirname(legacy), { recursive: true })
    await writeFile(legacy, '# jieba legacy dict\n', 'utf8')
    try {
      if (existsSync(migrated)) {
        await rm(migrated)
      }
      const ok = await isDictVariantDownloaded('zh-jieba', 'small', userId)
      assert.equal(ok, true)
      assert.ok(existsSync(migrated))
    } finally {
      await rm(path.dirname(legacy), { recursive: true, force: true })
      await rm(hybridFtsRoot(userId), { recursive: true, force: true })
    }
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
