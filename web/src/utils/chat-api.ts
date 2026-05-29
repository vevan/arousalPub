import type { useConnectionStore } from '@/stores/connection'
import type { PromptTrigger } from '@/stores/prompts'
import type { ChatPersistPayload } from '@/types/chat-turn'

type ConnectionStore = ReturnType<typeof useConnectionStore>

export interface ConversationChatRequestParams {
  userText: string
  promptTrigger: PromptTrigger
  historyBeforeTurnOrdinalExclusive?: number
  regenerateTurnOrdinal?: number
}

export function buildConversationChatRequestBody(
  conn: ConnectionStore,
  conversationId: string,
  params: ConversationChatRequestParams,
) {
  let customParams: Record<string, unknown> | undefined
  if (conn.customParamsJson.trim()) {
    customParams = conn.parseCustomParams()
  }

  return {
    alias: conn.alias.trim() || undefined,
    baseUrl: conn.baseUrl.trim() || undefined,
    apiKey: conn.apiKey.trim(),
    model: conn.model.trim(),
    conversationId,
    userText: params.userText,
    promptTrigger: params.promptTrigger,
    ...(params.historyBeforeTurnOrdinalExclusive !== undefined
      ? {
          historyBeforeTurnOrdinalExclusive:
            params.historyBeforeTurnOrdinalExclusive,
        }
      : {}),
    ...(params.regenerateTurnOrdinal !== undefined
      ? { regenerateTurnOrdinal: params.regenerateTurnOrdinal }
      : {}),
    stream: conn.stream,
    contextLength: conn.contextLength ?? undefined,
    maxTokens: conn.maxTokens ?? undefined,
    temperature: conn.temperature ?? undefined,
    topP: conn.topP ?? undefined,
    topK: conn.topK ?? undefined,
    dry: conn.dry ?? undefined,
    frequencyPenalty: conn.frequencyPenalty ?? undefined,
    presencePenalty: conn.presencePenalty ?? undefined,
    customParams,
    requestReasoning: conn.requestReasoningChain,
  }
}

export async function readSseStream(
  body: ReadableStream<Uint8Array> | null,
  onDelta: (d: { text?: string; reasoning?: string }) => void,
  noStreamMessage: string,
): Promise<void> {
  if (!body) throw new Error(noStreamMessage)
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const line of parts) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const data = trimmed.slice(5).trim()
      if (data === '[DONE]') continue
      try {
        const j = JSON.parse(data) as {
          choices?: {
            delta?: {
              content?: string
              reasoning_content?: string
              reasoning?: string
              thinking?: string
            }
          }[]
        }
        const d = j.choices?.[0]?.delta
        if (!d) continue
        const out: { text?: string; reasoning?: string } = {}
        if (typeof d.content === 'string' && d.content.length > 0) {
          out.text = d.content
        }
        const rs =
          typeof d.reasoning_content === 'string'
            ? d.reasoning_content
            : typeof d.reasoning === 'string'
              ? d.reasoning
              : typeof d.thinking === 'string'
                ? d.thinking
                : ''
        if (rs.length > 0) out.reasoning = rs
        if (out.text !== undefined || out.reasoning !== undefined) onDelta(out)
      } catch {
        /* ignore non-JSON lines */
      }
    }
  }
}

export async function runChatRequest(options: {
  conn: ConnectionStore
  conversationId: string
  params: ConversationChatRequestParams
  requestFailedMessage: (status: string) => string
  noStreamMessage: string
  onStreamDelta?: (d: { text?: string; reasoning?: string }) => void
}): Promise<{
  content: string
  reasoning?: string
  persist?: ChatPersistPayload
  durationMs?: number
  estimatedTokens?: number
}> {
  const { conn, conversationId, params, requestFailedMessage, noStreamMessage } =
    options
  const startedAt = performance.now()
  const res = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      buildConversationChatRequestBody(conn, conversationId, params),
    ),
  })

  if (!res.ok) {
    const text = await res.text()
    let msg = text
    try {
      const j = JSON.parse(text) as { detail?: string; error?: string }
      msg = j.detail || j.error || text
    } catch {
      /* not JSON */
    }
    throw new Error(
      msg.slice(0, 2000) || requestFailedMessage(String(res.status)),
    )
  }

  const ct = res.headers.get('content-type') ?? ''
  if (conn.stream && ct.includes('text/event-stream') && res.body) {
    let acc = ''
    let accR = ''
    await readSseStream(
      res.body,
      (d) => {
        if (d.text) acc += d.text
        if (d.reasoning) accR += d.reasoning
        options.onStreamDelta?.(d)
      },
      noStreamMessage,
    )
    const reasoning = accR.trim() || undefined
    return {
      content: acc,
      reasoning,
      durationMs: Math.round(performance.now() - startedAt),
    }
  }

  const data = (await res.json()) as {
    message?: { content?: string; reasoning?: string; reasoning_content?: string }
    persist?: ChatPersistPayload
    estimatedTokens?: number
  }
  const msg = data.message
  const content = typeof msg?.content === 'string' ? msg.content : ''
  const rawR = msg?.reasoning ?? msg?.reasoning_content
  const reasoning =
    typeof rawR === 'string' && rawR.trim() ? rawR.trim() : undefined
  return {
    content,
    reasoning,
    persist: data.persist,
    durationMs: Math.round(performance.now() - startedAt),
    estimatedTokens:
      typeof data.estimatedTokens === 'number' && data.estimatedTokens > 0
        ? Math.round(data.estimatedTokens)
        : undefined,
  }
}
