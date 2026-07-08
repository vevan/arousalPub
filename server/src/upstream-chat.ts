/** OpenAI 兼容 POST /chat/completions（非流式） */

export const API_PRESET_TEST_USER_MESSAGE =
  'Reply with the single word "ok" only, no punctuation or other text.'

export function looksLikeTruncationNotice(text: string): boolean {
  const t = text.trim().toLowerCase()
  if (!t) return false
  return (
    t.includes('truncated') ||
    t.includes('wafer:') ||
    (t.includes('reasoning') &&
      (t.includes('before') || t.includes('internal')))
  )
}

export function extractAssistantContent(json: unknown): string {
  if (!json || typeof json !== 'object') return ''
  const o = json as Record<string, unknown>
  const choices = o.choices
  if (!Array.isArray(choices) || choices.length === 0) return ''
  const first = choices[0]
  if (!first || typeof first !== 'object') return ''
  const msg = (first as { message?: unknown }).message
  if (!msg || typeof msg !== 'object') return ''
  const content = (msg as { content?: unknown }).content
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (!part || typeof part !== 'object') return ''
        const p = part as { type?: unknown; text?: unknown }
        if (p.type === 'text' && typeof p.text === 'string') return p.text
        return ''
      })
      .join('')
      .trim()
  }
  return ''
}

export interface UpstreamChatResult {
  ok: true
  requestUrl: string
  latencyMs: number
  model: string
  replyPreview: string
  /** 正文像网关截断/思维链占位提示 */
  replyWarning?: 'truncated'
}

export interface UpstreamChatError {
  ok: false
  requestUrl: string
  latencyMs: number
  model: string
  status?: number
  detail?: string
}

export async function fetchUpstreamChatCompletion(opts: {
  baseUrl: string
  apiKey: string
  model: string
  userMessage?: string
  maxTokens?: number
}): Promise<UpstreamChatResult | UpstreamChatError> {
  const base = opts.baseUrl.replace(/\/+$/, '')
  const requestUrl = `${base}/chat/completions`
  const model = opts.model.trim()
  const started = Date.now()
  const payload: Record<string, unknown> = {
    model,
    messages: [
      {
        role: 'user' as const,
        content: opts.userMessage ?? API_PRESET_TEST_USER_MESSAGE,
      },
    ],
    max_tokens: opts.maxTokens ?? 1024,
    temperature: 0,
    stream: false,
    /** 连通性探测：尽量关闭思维链，避免 token 预算被 reasoning 吃光 */
    thinking: { type: 'disabled' },
  }

  const { fetchWithTimeout } = await import('./fetch-with-timeout.js')
  const upstream = await fetchWithTimeout(requestUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify(payload),
  })
  const latencyMs = Date.now() - started
  const text = await upstream.text()

  if (!upstream.ok) {
    return {
      ok: false,
      requestUrl,
      latencyMs,
      model,
      status: upstream.status,
      detail: text.slice(0, 1500),
    }
  }

  let json: unknown
  try {
    json = JSON.parse(text) as unknown
  } catch {
    return {
      ok: false,
      requestUrl,
      latencyMs,
      model,
      detail: text.slice(0, 1500),
    }
  }

  const reply = extractAssistantContent(json)
  if (!reply) {
    return {
      ok: false,
      requestUrl,
      latencyMs,
      model,
      detail: text.slice(0, 1500),
    }
  }

  return {
    ok: true,
    requestUrl,
    latencyMs,
    model,
    replyPreview: reply.slice(0, 500),
    replyWarning: looksLikeTruncationNotice(reply) ? 'truncated' : undefined,
  }
}
