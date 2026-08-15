import assert from 'node:assert/strict'
import { createReadStream } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'
import AdmZip from 'adm-zip'
import {
  DictImportError,
  downloadDictVariant,
  hybridFtsDictPath,
  importLinderaDictZipStream,
  installLinderaDictZipFromPath,
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

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
)
const OFFICIAL_IPADIC_ZIP = path.join(
  REPO_ROOT,
  '.tmp',
  'lindera dic',
  '3.0.7',
  'lindera-ipadic-3.0.7.zip',
)
const LEGACY_IPADIC_ZIP = path.join(
  REPO_ROOT,
  '.tmp',
  'lindera dic',
  '5.2.0',
  'lindera-ipadic-5.2.0.zip',
)

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
      assert.equal(typeof entry?.sha256, 'string')
      assert.equal(entry?.sha256?.length, 64)
      assert.equal(entry?.sizeBytes, 15_880_290)
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

  it('imports the official v3.0.7 ipadic zip and rejects v5.2.0', async () => {
    const userId = 'lindera-zip-import-official'
    const kind = 'ipadic'
    try {
      await rm(path.dirname(hybridFtsDictPath(userId, 'lindera', kind)), {
        recursive: true,
        force: true,
      })
      await installLinderaDictZipFromPath(OFFICIAL_IPADIC_ZIP, kind, userId)
      assert.equal(await isDictVariantDownloaded('lindera', kind, userId), true)
      const meta = JSON.parse(
        await readFile(path.join(linderaDictDir(userId, kind), 'metadata.json'), 'utf8'),
      ) as { name?: string }
      assert.equal(meta.name, 'ipadic')

      await assert.rejects(
        () => installLinderaDictZipFromPath(LEGACY_IPADIC_ZIP, kind, userId),
        (err: unknown) => {
          assert.ok(err instanceof DictImportError)
          assert.equal(err.reason, 'package_mismatch')
          return true
        },
      )
      // 失败后旧词典仍可用
      assert.equal(await isDictVariantDownloaded('lindera', kind, userId), true)
    } finally {
      await rm(path.dirname(path.dirname(linderaDictDir(userId, kind))), {
        recursive: true,
        force: true,
      })
    }
  })

  it('rejects a wrong-variant official zip even when SHA is for another kind', async () => {
    const userId = 'lindera-zip-import-wrong-variant'
    const kind = 'ipadic'
    const cedictZip = path.join(
      REPO_ROOT,
      '.tmp',
      'lindera dic',
      '3.0.7',
      'lindera-cc-cedict-3.0.7.zip',
    )
    try {
      await rm(path.dirname(hybridFtsDictPath(userId, 'lindera', kind)), {
        recursive: true,
        force: true,
      })
      await assert.rejects(
        () => installLinderaDictZipFromPath(cedictZip, kind, userId),
        (err: unknown) => {
          assert.ok(err instanceof DictImportError)
          assert.equal(err.reason, 'package_mismatch')
          return true
        },
      )
      assert.equal(await isDictVariantDownloaded('lindera', kind, userId), false)
    } finally {
      await rm(path.dirname(path.dirname(linderaDictDir(userId, kind))), {
        recursive: true,
        force: true,
      })
    }
  })

  it('matches and imports an official zip by SHA-256', async () => {
    const userId = 'lindera-zip-import-stream'
    const kind = 'ipadic'
    try {
      await rm(path.dirname(hybridFtsDictPath(userId, 'lindera', kind)), {
        recursive: true,
        force: true,
      })
      const matchedKind = await importLinderaDictZipStream(
        createReadStream(OFFICIAL_IPADIC_ZIP),
        { userId },
      )
      assert.equal(matchedKind, kind)
      assert.equal(await isDictVariantDownloaded('lindera', kind, userId), true)
    } finally {
      await rm(path.dirname(path.dirname(linderaDictDir(userId, kind))), {
        recursive: true,
        force: true,
      })
    }
  })

  it('rejects an upload whose SHA-256 matches no catalog entry', async () => {
    await assert.rejects(
      () =>
        importLinderaDictZipStream(Readable.from(Buffer.from('unknown package')), {
          userId: 'lindera-zip-import-unknown',
        }),
      (err: unknown) => {
        assert.ok(err instanceof DictImportError)
        assert.equal(err.reason, 'package_mismatch')
        assert.match(err.message, /does not match any supported lindera package/)
        return true
      },
    )
  })
})
