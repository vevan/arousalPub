import { resolveUpstreamUrlPolicy } from './config.js'
import type { ResolvedEmbeddingCredentials } from './embedding-credential-resolve.js'
import {
  assertUpstreamBaseUrlAllowed,
  UpstreamUrlBlockedError,
} from './upstream-url-guard.js'

export interface EmbeddingResult {
  vector: number[]
  model: string
}

export interface EmbeddingRequestError {
  error: string
  status?: number
  detail?: string
}

function normalizeBaseUrl(baseUrl: string): string {
  let u = baseUrl.trim().replace(/\/+$/, '')
  u = u.replace(/\/embeddings$/i, '')
  if (!u.endsWith('/v1')) {
    u = `${u}/v1`
  }
  return u
}

export function buildEmbeddingRequestUrl(baseUrl: string): string {
  const forGuard = baseUrl
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/embeddings$/i, '')
  try {
    assertUpstreamBaseUrlAllowed(forGuard, resolveUpstreamUrlPolicy())
  } catch (e) {
    if (e instanceof UpstreamUrlBlockedError) {
      throw e
    }
    throw e
  }
  return `${normalizeBaseUrl(baseUrl)}/embeddings`
}

/**
 * OpenAI 兼容 POST /embeddings（使用指定连接配置）
 */
export async function createEmbeddingWithCredentials(
  creds: ResolvedEmbeddingCredentials,
  text: string,
): Promise<EmbeddingResult | EmbeddingRequestError> {
  const corpus = text.trim()
  if (!corpus) {
    return { error: '测试文本为空' }
  }
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
      input: corpus,
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
  let j: { data?: { embedding?: number[] }[]; model?: string }
  try {
    j = (await res.json()) as typeof j
  } catch {
    return { error: 'Embeddings API 响应不是合法 JSON' }
  }
  const vec = j.data?.[0]?.embedding
  if (!Array.isArray(vec) || vec.length === 0) {
    return { error: 'Embeddings API 响应缺少 embedding 向量' }
  }
  return {
    vector: vec.map((x) => Number(x)),
    model: typeof j.model === 'string' ? j.model : creds.embeddingModel,
  }
}

/**
 * 使用全局 user-preferences 中的 Embeddings API 连接
 */
export async function createEmbedding(
  text: string,
  conversationId?: string | null,
): Promise<EmbeddingResult | null> {
  const { resolveEmbeddingApiCredentials } = await import(
    './embedding-credential-resolve.js'
  )
  const creds = await resolveEmbeddingApiCredentials(conversationId)
  if (!creds) return null
  const out = await createEmbeddingWithCredentials(creds, text)
  if ('error' in out) {
    // eslint-disable-next-line no-console
    console.warn(`[embedding] ${out.error}`, out.detail ?? '')
    return null
  }
  return out
}
