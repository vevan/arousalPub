import type { ResolvedEmbeddingCredentials } from './embedding-credential-resolve.js'
import {
  buildEmbeddingRequestUrl,
  createEmbeddingWithCredentials,
  type EmbeddingRequestError,
  type EmbeddingResult,
} from './embedding-client.js'

/** 单次 Embeddings API 请求最多条数（OpenAI 兼容 input 数组） */
export const EMBEDDING_BATCH_MAX_INPUTS = 32

/** 并行批次数上限（每批最多 EMBEDDING_BATCH_MAX_INPUTS 条） */
export const EMBEDDING_REINDEX_BATCH_CONCURRENCY = 4

export interface EmbeddingBatchItem {
  /** 调用方自定义，与返回 vectors 下标对齐 */
  key: string
  text: string
}

export type EmbeddingBatchVectorsResult =
  | { ok: true; vectors: Map<string, number[]>; model: string }
  | EmbeddingRequestError

export function isEmbeddingBatchOk(
  result: EmbeddingBatchVectorsResult,
): result is { ok: true; vectors: Map<string, number[]>; model: string } {
  return 'ok' in result && result.ok
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}

async function createEmbeddingsBatchRequest(
  creds: ResolvedEmbeddingCredentials,
  items: EmbeddingBatchItem[],
): Promise<EmbeddingBatchVectorsResult> {
  if (!items.length) {
    return { ok: true, vectors: new Map(), model: creds.embeddingModel }
  }

  const inputs = items.map((it) => it.text.trim())
  const url = buildEmbeddingRequestUrl(creds.baseUrl)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }
  if (creds.apiKey.trim()) {
    headers.Authorization = `Bearer ${creds.apiKey.trim()}`
  }

  let res: Response
  try {
    const body: Record<string, unknown> = {
      model: creds.embeddingModel,
      input: inputs,
    }
    if (creds.embeddingDimensions != null) {
      body.dimensions = creds.embeddingDimensions
    }
    const { fetchWithTimeout } = await import('./fetch-with-timeout.js')
    res = await fetchWithTimeout(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return { error: '无法连接 Embeddings API', detail: msg }
  }

  if (!res.ok) {
    const errText = await res.text().catch(() => '')
    return {
      error: `Embeddings API 返回 HTTP ${res.status}`,
      status: res.status,
      detail: errText.slice(0, 500),
    }
  }

  let j: {
    data?: { index?: number; embedding?: number[] }[]
    model?: string
  }
  try {
    j = (await res.json()) as typeof j
  } catch {
    return { error: 'Embeddings API 响应不是合法 JSON' }
  }

  const rows = j.data
  if (!Array.isArray(rows) || rows.length !== items.length) {
    return { error: 'Embeddings API 批量响应条数与请求不一致' }
  }

  const vectors = new Map<string, number[]>()
  for (const row of rows) {
    const idx = Number(row.index)
    if (!Number.isInteger(idx) || idx < 0 || idx >= items.length) {
      return { error: 'Embeddings API 批量响应 index 非法' }
    }
    const raw = row.embedding
    if (!Array.isArray(raw) || raw.length === 0) {
      return { error: 'Embeddings API 响应缺少 embedding 向量' }
    }
    vectors.set(items[idx]!.key, raw.map((x) => Number(x)))
  }

  return {
    ok: true,
    vectors,
    model: typeof j.model === 'string' ? j.model : creds.embeddingModel,
  }
}

/** 单批失败时回退为逐条请求（兼容不支持 input 数组的上游） */
async function embedBatchWithFallback(
  creds: ResolvedEmbeddingCredentials,
  items: EmbeddingBatchItem[],
): Promise<EmbeddingBatchVectorsResult> {
  const batch = await createEmbeddingsBatchRequest(creds, items)
  if ('ok' in batch && batch.ok) return batch

  const vectors = new Map<string, number[]>()
  let model = creds.embeddingModel
  for (const it of items) {
    const emb = await createEmbeddingWithCredentials(creds, it.text)
    if ('error' in emb) return emb
    vectors.set(it.key, emb.vector)
    model = emb.model
  }
  return { ok: true, vectors, model }
}

/**
 * 批量 embedding：先按批请求，失败则逐条回退；多批之间有限并发。
 */
export async function embedTextsInBatches(
  creds: ResolvedEmbeddingCredentials,
  items: EmbeddingBatchItem[],
  options?: {
    batchSize?: number
    concurrency?: number
  },
): Promise<EmbeddingBatchVectorsResult> {
  const valid = items.filter((it) => it.text.trim().length > 0)
  if (!valid.length) {
    return { ok: true, vectors: new Map(), model: creds.embeddingModel }
  }

  const batchSize = Math.max(
    1,
    Math.min(
      options?.batchSize ?? EMBEDDING_BATCH_MAX_INPUTS,
      EMBEDDING_BATCH_MAX_INPUTS,
    ),
  )
  const concurrency = Math.max(
    1,
    Math.min(
      options?.concurrency ?? EMBEDDING_REINDEX_BATCH_CONCURRENCY,
      EMBEDDING_REINDEX_BATCH_CONCURRENCY,
    ),
  )

  const chunks = chunkArray(valid, batchSize)
  const merged = new Map<string, number[]>()
  let model = creds.embeddingModel

  for (let i = 0; i < chunks.length; i += concurrency) {
    const wave = chunks.slice(i, i + concurrency)
    const results = await Promise.all(
      wave.map((chunk) => embedBatchWithFallback(creds, chunk)),
    )
    for (const r of results) {
      if (!('ok' in r) || !r.ok) return r
      model = r.model
      for (const [k, v] of r.vectors) merged.set(k, v)
    }
  }

  return { ok: true, vectors: merged, model }
}

export type { EmbeddingResult }
