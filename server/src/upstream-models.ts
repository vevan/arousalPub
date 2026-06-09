/** 解析 OpenAI 兼容 GET /models 响应中的模型 id 列表 */

export function extractModelIds(json: unknown): string[] {
  if (!json || typeof json !== 'object') return []
  const o = json as Record<string, unknown>
  if (Array.isArray(o.data)) {
    const ids = o.data
      .map((x) => {
        if (x && typeof x === 'object' && x !== null && 'id' in x) {
          const id = (x as { id: unknown }).id
          return typeof id === 'string' ? id : ''
        }
        return ''
      })
      .filter((s): s is string => s.length > 0)
    return [...new Set(ids)]
  }
  if (Array.isArray(o.models)) {
    const ids = o.models
      .map((x) => {
        if (typeof x === 'string') return x
        if (x && typeof x === 'object' && x !== null) {
          if ('id' in x) {
            const id = (x as { id: unknown }).id
            if (typeof id === 'string') return id
          }
          if ('name' in x) {
            const n = (x as { name: unknown }).name
            if (typeof n === 'string') return n
          }
        }
        return ''
      })
      .filter((s): s is string => s.length > 0)
    return [...new Set(ids)]
  }
  return []
}

export interface UpstreamModelsResult {
  ok: true
  models: string[]
  requestUrl: string
  latencyMs: number
}

export interface UpstreamModelsError {
  ok: false
  requestUrl: string
  status?: number
  detail?: string
  latencyMs: number
}

export async function fetchUpstreamModelsList(opts: {
  baseUrl: string
  apiKey: string
}): Promise<UpstreamModelsResult | UpstreamModelsError> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const requestUrl = `${base}/models`
  const started = Date.now()
  const { fetchWithTimeout } = await import('./fetch-with-timeout.js')
  const upstream = await fetchWithTimeout(requestUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${opts.apiKey}` },
  })
  const latencyMs = Date.now() - started
  const text = await upstream.text()
  if (!upstream.ok) {
    return {
      ok: false,
      requestUrl,
      status: upstream.status,
      detail: text.slice(0, 1500),
      latencyMs,
    }
  }
  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    return {
      ok: false,
      requestUrl,
      detail: text.slice(0, 1500),
      latencyMs,
    }
  }
  const models = extractModelIds(json).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: 'base' }),
  )
  return { ok: true, models, requestUrl, latencyMs }
}
