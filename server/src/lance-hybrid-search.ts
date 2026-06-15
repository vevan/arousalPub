import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { Index, rerankers, type Table } from '@lancedb/lancedb'
import {
  formatHybridFtsSpec,
  HYBRID_FTS_SETTINGS_DEFAULTS,
  normalizeHybridFtsSettings,
  type HybridFtsProfile,
  type HybridFtsSettings,
} from './hybrid-fts-settings.js'
import { prepareHybridFtsSettings } from './hybrid-fts-dict.js'

/** Memory Lance 表 FTS 列 */
export const MEMORY_FTS_COLUMN = 'corpus'

/** 资料库 vector Lance 表 FTS 列 */
export const LORE_FTS_COLUMN = 'text'

export const HYBRID_FTS_PROFILE_STAMP = '.hybrid-fts-profile.json'

/** 中文（及中英混排）BM25：字符 n-gram，不用 English stemming */
export function chineseFtsIndexOptions() {
  return ftsIndexOptionsForProfile('zh-ngram')
}

export function ftsIndexOptionsForProfile(profile: HybridFtsProfile) {
  switch (profile) {
    case 'en':
      return {
        baseTokenizer: 'simple' as const,
        language: 'English' as const,
        lowercase: true,
        stem: true,
        removeStopWords: true,
        asciiFolding: true,
      }
    case 'zh-jieba':
      return {
        baseTokenizer: 'jieba/default' as const,
        stem: false,
        removeStopWords: false,
        lowercase: false,
        asciiFolding: false,
      }
    case 'zh-ngram':
    default:
      return {
        baseTokenizer: 'ngram' as const,
        ngramMinLength: 2,
        ngramMaxLength: 3,
        lowercase: false,
        stem: false,
        removeStopWords: false,
        asciiFolding: false,
      }
  }
}

let rrfRerankerPromise: Promise<rerankers.RRFReranker> | null = null

function sharedRrfReranker(): Promise<rerankers.RRFReranker> {
  if (!rrfRerankerPromise) {
    rrfRerankerPromise = rerankers.RRFReranker.create()
  }
  return rrfRerankerPromise
}

export async function tableHasFtsIndex(
  table: Table,
  column: string,
): Promise<boolean> {
  const indices = await table.listIndices()
  return indices.some(
    (idx) =>
      idx.indexType === 'FTS' &&
      Array.isArray(idx.columns) &&
      idx.columns.includes(column),
  )
}

function hybridFtsProfileStampPath(stampDir: string): string {
  return path.join(stampDir, HYBRID_FTS_PROFILE_STAMP)
}

async function readHybridFtsSpecStamp(stampDir: string): Promise<string | null> {
  const stampPath = hybridFtsProfileStampPath(stampDir)
  if (!existsSync(stampPath)) return null
  try {
    const raw = JSON.parse(await readFile(stampPath, 'utf8')) as {
      spec?: unknown
      profile?: unknown
    }
    if (typeof raw.spec === 'string' && raw.spec.trim()) return raw.spec.trim()
    if (typeof raw.profile === 'string' && raw.profile.trim()) {
      return raw.profile.trim()
    }
  } catch {
    /* ignore */
  }
  return null
}

async function writeHybridFtsSpecStamp(
  stampDir: string,
  spec: string,
): Promise<void> {
  const stampPath = hybridFtsProfileStampPath(stampDir)
  await writeFile(stampPath, JSON.stringify({ spec }, null, 2), 'utf8')
}

/** 表重建或 bulk 写入后确保 BM25 FTS 索引存在且与 spec 一致 */
export async function ensureHybridFtsIndex(
  table: Table,
  column: string,
  settings: HybridFtsSettings = HYBRID_FTS_SETTINGS_DEFAULTS,
  stampDir: string,
): Promise<void> {
  const normalized = normalizeHybridFtsSettings(settings)
  const spec = formatHybridFtsSpec(normalized)
  const stamped = await readHybridFtsSpecStamp(stampDir)
  const hasFts = await tableHasFtsIndex(table, column)
  if (hasFts && stamped === spec) return

  await prepareHybridFtsSettings(normalized)
  await table.createIndex(column, {
    config: Index.fts(ftsIndexOptionsForProfile(normalized.profile)),
    replace: true,
    waitTimeoutSeconds: 120,
  })
  await writeHybridFtsSpecStamp(stampDir, spec)
}

export function hybridRelevanceScore(row: Record<string, unknown>): number {
  const rrf = Number(row._relevance_score)
  if (Number.isFinite(rrf)) return rrf
  const dist = Number(row._distance ?? 0)
  return 1 / (1 + dist)
}

export interface LanceHybridSearchParams {
  table: Table
  queryVector: number[]
  queryText: string
  textColumn: string
  limit: number
  whereClause?: string
}

/**
 * FTS + vector + RRF；失败或无 query 文本时回退纯向量检索。
 */
export async function runLanceHybridSearch(
  params: LanceHybridSearchParams,
): Promise<Record<string, unknown>[]> {
  const { table, queryVector, queryText, textColumn, limit, whereClause } =
    params
  if (!queryVector.length || limit < 1) return []

  const trimmedQuery = queryText.trim()
  if (trimmedQuery.length > 0 && (await tableHasFtsIndex(table, textColumn))) {
    try {
      const reranker = await sharedRrfReranker()
      let query = table
        .vectorSearch(queryVector)
        .fullTextSearch(trimmedQuery, { columns: textColumn })
        .rerank(reranker)
      if (whereClause) {
        query = query.where(whereClause)
      }
      return (await query.limit(limit).toArray()) as Record<string, unknown>[]
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[lance-hybrid-search] hybrid failed, falling back to vector:', e)
    }
  }

  let vectorQuery = table.vectorSearch(queryVector)
  if (whereClause) {
    vectorQuery = vectorQuery.where(whereClause)
  }
  return (await vectorQuery.limit(limit).toArray()) as Record<string, unknown>[]
}
