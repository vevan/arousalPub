import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, it } from 'node:test'
import AdmZip from 'adm-zip'
import {
  downloadDictVariant,
  hybridFtsDictPath,
  isDictVariantDownloaded,
  linderaDictDir,
} from '../src/hybrid-fts-dict.js'
import { dictVariantEntryForProfile } from '../src/hybrid-fts-catalog.js'

const REQUIRED_FILES = [
  'char_def.bin',
  'dict.da',
  'dict.vals',
  'dict.words',
  'dict.wordsidx',
  'matrix.mtx',
  'unk.bin',
] as const

function buildLinderaZip(zipPath: string, entries: Array<[string, Buffer]>): void {
  const zip = new AdmZip()
  for (const [name, body] of entries) {
    zip.addFile(name, body)
  }
  zip.writeZip(zipPath)
}

describe('lindera zip install', () => {
  it('extracts a synthetic zip into lindera/{kind} with config.yml', async () => {
    const userId = 'lindera-zip-unit#percent%'
    const kind = 'ipadic'
    const work = await mkdtemp(path.join(tmpdir(), 'lindera-zip-unit-'))
    const zipPath = path.join(work, 'lindera-ipadic-3.0.7.zip')
    try {
      buildLinderaZip(zipPath, [
        ...REQUIRED_FILES.map(
          (name) => [`lindera-ipadic/${name}`, Buffer.from(`synthetic-${name}`)] as [string, Buffer],
        ),
        ['lindera-ipadic/metadata.json', Buffer.from('{"name":"synthetic-ipadic"}')],
      ])

      const originalFetch = globalThis.fetch
      let fetchCalls = 0
      globalThis.fetch = (async () => {
        fetchCalls += 1
        const buf = await readFile(zipPath)
        return new Response(buf, {
          status: 200,
          headers: { 'content-length': String(buf.length) },
        })
      }) as typeof fetch

      try {
        await rm(path.dirname(hybridFtsDictPath(userId, 'lindera', kind)), {
          recursive: true,
          force: true,
        })
        const phasesA: Array<string | undefined> = []
        const phasesB: Array<string | undefined> = []
        await Promise.all([
          downloadDictVariant(
            'lindera',
            kind,
            (progress) => phasesA.push(progress.phase),
            userId,
          ),
          downloadDictVariant(
            'lindera',
            kind,
            (progress) => phasesB.push(progress.phase),
            userId,
          ),
        ])
        assert.equal(fetchCalls, 1)
        assert.ok(phasesA.includes('extract'))
        assert.ok(phasesB.includes('extract'))
      } finally {
        globalThis.fetch = originalFetch
      }

      assert.equal(await isDictVariantDownloaded('lindera', kind, userId), true)
      const dictDir = linderaDictDir(userId, kind)
      const cfg = await readFile(path.join(dictDir, 'config.yml'), 'utf8')
      assert.match(cfg, /segmenter:/)
      assert.match(cfg, /mode: "normal"/)
      assert.match(cfg, /dictionary: "file:\/\//)
      assert.match(cfg, /lindera-zip-unit%23percent%25/)
      const metadata = await readFile(path.join(dictDir, 'metadata.json'), 'utf8')
      assert.equal(metadata, '{"name":"synthetic-ipadic"}')
      await writeFile(
        path.join(dictDir, 'config.yml'),
        'segmenter:\n  mode: "normal"\n  dictionary: "file:///stale"\n',
      )
      assert.equal(await isDictVariantDownloaded('lindera', kind, userId), true)
      const rewritten = await readFile(path.join(dictDir, 'config.yml'), 'utf8')
      assert.match(rewritten, /lindera-zip-unit%23percent%25/)
      assert.doesNotMatch(rewritten, /file:\/\/\/stale/)
      await rm(path.join(dictDir, 'config.yml'), { force: true })
      assert.equal(await isDictVariantDownloaded('lindera', kind, userId), true)
      const regenerated = await readFile(path.join(dictDir, 'config.yml'), 'utf8')
      assert.match(regenerated, /lindera-zip-unit%23percent%25/)
      const entry = dictVariantEntryForProfile('lindera', kind)
      assert.equal(entry?.artifactKind, 'zip')
    } finally {
      await rm(work, { recursive: true, force: true })
      await rm(path.dirname(path.dirname(linderaDictDir(userId, kind))), {
        recursive: true,
        force: true,
      })
    }
  })

  it('rejects zip-slip and keeps previous dictionary files', async () => {
    const userId = 'lindera-zip-slip'
    const kind = 'ipadic'
    const work = await mkdtemp(path.join(tmpdir(), 'lindera-zip-slip-'))
    const goodZip = path.join(work, 'good.zip')
    const badZip = path.join(work, 'bad.zip')
    try {
      buildLinderaZip(goodZip, [
        ...REQUIRED_FILES.map(
          (name) => [`lindera-ipadic/${name}`, Buffer.from(`good-${name}`)] as [string, Buffer],
        ),
        ['lindera-ipadic/metadata.json', Buffer.from('{"name":"good"}')],
      ])
      buildLinderaZip(badZip, [
        ['../escape.bin', Buffer.from('pwn')],
        ['C:/Windows/Temp/pwn.txt', Buffer.from('pwn')],
        ...REQUIRED_FILES.map(
          (name) => [`lindera-ipadic/${name}`, Buffer.from(`bad-${name}`)] as [string, Buffer],
        ),
        ['lindera-ipadic/metadata.json', Buffer.from('{"name":"bad"}')],
      ])

      const originalFetch = globalThis.fetch
      globalThis.fetch = (async () => {
        const buf = await readFile(goodZip)
        return new Response(buf, {
          status: 200,
          headers: { 'content-length': String(buf.length) },
        })
      }) as typeof fetch
      try {
        await rm(path.dirname(hybridFtsDictPath(userId, 'lindera', kind)), {
          recursive: true,
          force: true,
        })
        await downloadDictVariant('lindera', kind, undefined, userId)
      } finally {
        globalThis.fetch = originalFetch
      }

      const dictDir = linderaDictDir(userId, kind)
      const beforeWords = await readFile(path.join(dictDir, 'dict.words'), 'utf8')
      assert.equal(beforeWords, 'good-dict.words')

      // 删掉一个核心文件以强制重装；config 自动重写不能单独触发下载
      await rm(path.join(dictDir, 'metadata.json'), { force: true })
      assert.equal(await isDictVariantDownloaded('lindera', kind, userId), false)

      globalThis.fetch = (async () => {
        const buf = await readFile(badZip)
        return new Response(buf, {
          status: 200,
          headers: { 'content-length': String(buf.length) },
        })
      }) as typeof fetch
      try {
        await assert.rejects(
          () => downloadDictVariant('lindera', kind, undefined, userId),
          (err: Error) => {
            assert.match(
              err.message,
              /unsafe path in lindera zip|lindera zip does not contain a complete dictionary/,
            )
            return true
          },
        )
      } finally {
        globalThis.fetch = originalFetch
      }

      const afterWords = await readFile(path.join(dictDir, 'dict.words'), 'utf8')
      assert.equal(afterWords, 'good-dict.words')
      assert.equal(await isDictVariantDownloaded('lindera', kind, userId), false)
    } finally {
      await rm(work, { recursive: true, force: true })
      await rm(path.dirname(path.dirname(linderaDictDir(userId, kind))), {
        recursive: true,
        force: true,
      })
    }
  })
})
