import type { useConnectionStore } from '@/stores/connection'
import type { PromptTrigger } from '@/stores/prompts'
import type { ChatPersistPayload } from '@/types/chat-turn'
import { translateApiError } from '@/utils/api-error-message'
import { hasAnyDrySamplerField } from '@/utils/dry-sampler'

type ConnectionStore = ReturnType<typeof useConnectionStore>

export interface GuidanceGeneratePluginPayload {
  mode: 'send' | 'regenerate'
  guidanceText: string
}

export interface ConversationChatRequestPlugins {
  'guidance-generate'?: GuidanceGeneratePluginPayload
}

export interface ConversationChatRequestParams {
  userText: string
  promptTrigger: PromptTrigger
  historyBeforeTurnOrdinalExclusive?: number
  regenerateTurnOrdinal?: number
  plugins?: ConversationChatRequestPlugins
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

  const dryFields = {
    dryMultiplier: conn.dryMultiplier,
    dryBase: conn.dryBase,
    dryAllowedLength: conn.dryAllowedLength,
    dryPenaltyLastN: conn.dryPenaltyLastN,
    drySequenceBreakers: conn.drySequenceBreakers,
  }

  return {
    alias: conn.alias.trim() || undefined,
    baseUrl: conn.baseUrl.trim() || undefined,
    apiPresetId: conn.activePresetId ?? undefined,
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
    ...(params.plugins ? { plugins: params.plugins } : {}),
    stream: conn.stream,
    contextLength: conn.contextLength ?? undefined,
    maxTokens: conn.maxTokens ?? undefined,
    temperature: conn.temperature ?? undefined,
    topP: conn.topP ?? undefined,
    topK: conn.topK ?? undefined,
    ...(hasAnyDrySamplerField(dryFields)
      ? {
          dryMultiplier: dryFields.dryMultiplier ?? undefined,
          dryBase: dryFields.dryBase ?? undefined,
          dryAllowedLength: dryFields.dryAllowedLength ?? undefined,
          dryPenaltyLastN: dryFields.dryPenaltyLastN ?? undefined,
          drySequenceBreakers:
            dryFields.drySequenceBreakers.length > 0
              ? dryFields.drySequenceBreakers
              : undefined,
        }
      : {}),
    frequencyPenalty: conn.frequencyPenalty ?? undefined,
    presencePenalty: conn.presencePenalty ?? undefined,
    customParams,
    requestReasoning: conn.requestReasoningChain,
  }
}

function completionTokensFromSsePayload(j: unknown): number | undefined {
  if (!j || typeof j !== 'object') return undefined
  const usage = (j as { usage?: unknown }).usage
  if (!usage || typeof usage !== 'object') return undefined
  const u = usage as Record<string, unknown>
  const raw =
    typeof u.completion_tokens === 'number'
      ? u.completion_tokens
      : typeof u.completionTokens === 'number'
        ? u.completionTokens
        : undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return undefined
  }
  return Math.round(raw)
}

export async function readSseStream(
  body: ReadableStream<Uint8Array> | null,
  onDelta: (d: { text?: string; reasoning?: string }) => void,
  noStreamMessage: string,
  onCompletionTokens?: (n: number) => void,
  onPersist?: (persist: ChatPersistPayload) => void,
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
          arousal?: { persist?: ChatPersistPayload }
          choices?: {
            delta?: {
              content?: string
              reasoning_content?: string
              reasoning?: string
              thinking?: string
            }
          }[]
        }
        const persist = j.arousal?.persist
        if (persist && typeof persist === 'object' && 'ok' in persist) {
          onPersist?.(persist)
          continue
        }
        const ct = completionTokensFromSsePayload(j)
        if (ct) onCompletionTokens?.(ct)
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
  /** 流式响应头中的组装 token 估算（与 /api/chat 非流式 JSON 的 estimatedTokens 一致） */
  onPromptEstimatedTokens?: (n: number) => void
  /** 流式 SSE 末包 usage.completion_tokens */
  onCompletionTokens?: (n: number) => void
  /** 流式：服务端落盘完成后经 SSE 推送；非流式：随 JSON 一并返回时也会调用 */
  onPersist?: (persist: ChatPersistPayload) => void
}): Promise<{
  content: string
  reasoning?: string
  persist?: ChatPersistPayload
  durationMs?: number
  estimatedTokens?: number
  completionTokens?: number
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
      if (typeof j.error === 'string' && j.error.trim()) {
        msg = translateApiError(j.error.trim())
      } else {
        msg = j.detail || text
      }
    } catch {
      /* not JSON */
    }
    throw new Error(
      msg.slice(0, 2000) || requestFailedMessage(String(res.status)),
    )
  }

  const ct = res.headers.get('content-type') ?? ''
  if (conn.stream && ct.includes('text/event-stream') && res.body) {
    let streamEstimatedTokens: number | undefined
    const etRaw = res.headers.get('X-Prompt-Estimated-Tokens')
    if (etRaw) {
      const et = Number.parseInt(etRaw, 10)
      if (Number.isFinite(et) && et > 0) {
        streamEstimatedTokens = et
        options.onPromptEstimatedTokens?.(et)
      }
    }
    let acc = ''
    let accR = ''
    let completionTokens: number | undefined
    let streamPersist: ChatPersistPayload | undefined
    await readSseStream(
      res.body,
      (d) => {
        if (d.text) acc += d.text
        if (d.reasoning) accR += d.reasoning
        options.onStreamDelta?.(d)
      },
      noStreamMessage,
      (n) => {
        completionTokens = n
        options.onCompletionTokens?.(n)
      },
      (persist) => {
        streamPersist = persist
        options.onPersist?.(persist)
      },
    )
    const reasoning = accR.trim() || undefined
    return {
      content: acc,
      reasoning,
      persist: streamPersist,
      durationMs: Math.round(performance.now() - startedAt),
      estimatedTokens: streamEstimatedTokens,
      completionTokens,
    }
  }

  const data = (await res.json()) as {
    message?: { content?: string; reasoning?: string; reasoning_content?: string }
    persist?: ChatPersistPayload
    estimatedTokens?: number
    completionTokens?: number
  }
  const msg = data.message
  const content = typeof msg?.content === 'string' ? msg.content : ''
  const rawR = msg?.reasoning ?? msg?.reasoning_content
  const reasoning =
    typeof rawR === 'string' && rawR.trim() ? rawR.trim() : undefined
  const estimatedTokens =
    typeof data.estimatedTokens === 'number' && data.estimatedTokens > 0
      ? Math.round(data.estimatedTokens)
      : undefined
  if (estimatedTokens) {
    options.onPromptEstimatedTokens?.(estimatedTokens)
  }
  const completionTokens =
    typeof data.completionTokens === 'number' && data.completionTokens > 0
      ? Math.round(data.completionTokens)
      : undefined
  if (completionTokens) {
    options.onCompletionTokens?.(completionTokens)
  }
  if (data.persist && typeof data.persist === 'object' && 'ok' in data.persist) {
    options.onPersist?.(data.persist)
  }
  return {
    content,
    reasoning,
    persist: data.persist,
    durationMs: Math.round(performance.now() - startedAt),
    estimatedTokens,
    completionTokens,
  }
}
