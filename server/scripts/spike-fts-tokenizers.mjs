/**
 * Spike: LanceDB Node FTS tokenizers (ngram / icu / jieba).
 * Run from repo: node server/scripts/spike-fts-tokenizers.mjs
 */
import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as lancedb from '@lancedb/lancedb'
import { Index, rerankers } from '@lancedb/lancedb'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')
const modelHome = path.join(repoRoot, '.tmp-lance-language-models')

const ROWS = [
  {
    turnId: 'a',
    corpus: '小明今天去北京故宫参观',
    vector: [1, 0, 0],
  },
  {
    turnId: 'b',
    corpus: 'The puppy runs happily in the park',
    vector: [0, 1, 0],
  },
  {
    turnId: 'c',
    corpus: '机器学习与向量检索可以 hybrid 融合',
    vector: [0, 0, 1],
  },
]

const QUERIES = {
  zh: '北京',
  en: 'puppy',
  mixed: '向量',
}

function tryDownloadJiebaModel() {
  const dictPath = path.join(modelHome, 'jieba', 'default', 'dict.txt')
  if (existsSync(dictPath)) {
    const head = readFileSync(dictPath, 'utf8').slice(0, 40)
    if (!head.includes('<!DOCTYPE')) {
      console.log(`\n[jieba] using existing dict: ${dictPath}`)
      return true
    }
  }
  console.log(`\n[jieba] model home: ${modelHome}`)
  const py = spawnSync('python', ['-m', 'lance.download', 'jieba'], {
    encoding: 'utf8',
    shell: true,
    env: { ...process.env, LANCE_LANGUAGE_MODEL_HOME: modelHome },
  })
  if (py.status === 0) {
    console.log('[jieba] python -m lance.download jieba OK')
    return true
  }
  console.log('[jieba] download via pylance failed; place dict.txt manually if needed')
  if (py.stdout) console.log(py.stdout.trim())
  if (py.stderr) console.log(py.stderr.trim())
  return existsSync(dictPath)
}

async function hybridSearch(table, queryText, queryVector) {
  const reranker = await rerankers.RRFReranker.create()
  const rows = await table
    .vectorSearch(queryVector)
    .fullTextSearch(queryText, { columns: 'corpus' })
    .rerank(reranker)
    .limit(3)
    .toArray()
  return rows.map((r) => String(r.corpus ?? ''))
}

async function runCase(name, ftsOptions) {
  const dir = mkdtempSync(path.join(tmpdir(), `lance-fts-${name}-`))
  const label = JSON.stringify(ftsOptions)
  console.log(`\n=== ${name} ===`)
  console.log(`options: ${label}`)
  try {
    const db = await lancedb.connect(dir)
    const table = await db.createTable('t', ROWS)
    await table.createIndex('corpus', {
      config: Index.fts(ftsOptions),
      replace: true,
      waitTimeoutSeconds: 120,
    })
    const indices = await table.listIndices()
    const fts = indices.filter((i) => i.indexType === 'FTS')
    console.log(`index: ${fts.length ? 'FTS created' : 'NO FTS index listed'}`)

    for (const [qname, qtext] of Object.entries(QUERIES)) {
      const vec = qname === 'en' ? [0, 1, 0] : [0, 0, 1]
      const hits = await hybridSearch(table, qtext, vec)
      console.log(`  query ${qname} "${qtext}": ${hits.length ? hits.join(' | ') : '(no hits)'}`)
    }
    console.log(`RESULT: ${name} OK`)
    return { name, ok: true, error: null }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.log(`RESULT: ${name} FAILED — ${msg}`)
    return { name, ok: false, error: msg }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

process.env.LANCE_LANGUAGE_MODEL_HOME = modelHome

console.log('LanceDB FTS tokenizer spike (Node)')
console.log(`LANCE_LANGUAGE_MODEL_HOME=${modelHome}`)

const jiebaModelReady = tryDownloadJiebaModel()

const cases = [
  {
    name: 'ngram-baseline',
    opts: {
      baseTokenizer: 'ngram',
      ngramMinLength: 2,
      ngramMaxLength: 3,
      lowercase: false,
      stem: false,
      removeStopWords: false,
      asciiFolding: false,
    },
  },
  {
    name: 'simple-english',
    opts: {
      baseTokenizer: 'simple',
      language: 'English',
      lowercase: true,
      stem: true,
      removeStopWords: true,
      asciiFolding: true,
    },
  },
  {
    name: 'icu-multilingual',
    opts: {
      baseTokenizer: 'icu',
      stem: false,
      removeStopWords: false,
      lowercase: false,
      asciiFolding: false,
    },
  },
]

if (jiebaModelReady) {
  cases.push({
    name: 'jieba-default',
    opts: {
      baseTokenizer: 'jieba/default',
      stem: false,
      removeStopWords: false,
      lowercase: false,
      asciiFolding: false,
    },
  })
}

const results = []
for (const c of cases) {
  results.push(await runCase(c.name, c.opts))
}

console.log('\n=== Summary ===')
for (const r of results) {
  console.log(`${r.ok ? 'OK' : 'FAIL'}  ${r.name}${r.error ? ` — ${r.error}` : ''}`)
}

const blockers = results.filter((r) => !r.ok && r.name !== 'icu-multilingual')
process.exit(blockers.length > 0 ? 1 : 0)
