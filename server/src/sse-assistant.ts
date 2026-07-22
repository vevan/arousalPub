import type { ChatPersistResult } from './chat-persist-after-chat.js'
import { extractCompletionTokens } from './chat-usage.js'

/** 流式聊天结束后追加的落盘结果（前端 readSseStream 识别 arousal.persist） */
export function formatArousalPersistSseLine(
  persist: ChatPersistResult,
): string {
  return `data: ${JSON.stringify({ arousal: { persist } })}\n\n`
}

/** 组装/掷骰完成后尽早下发当选 speaker（前端 patch pending 气泡） */
export function formatArousalSpeakerSseLine(speakerCharacterId: string): string {
  const id = speakerCharacterId.trim()
  if (!id) return ''
  return `data: ${JSON.stringify({ arousal: { speakerCharacterId: id } })}\n\n`
}

/** 已开始 SSE 后的上游失败（不能再改成 JSON 502） */
export function formatArousalStreamErrorSseLine(error: string, detail?: string): string {
  return `data: ${JSON.stringify({
    arousal: {
      error: error.trim() || 'upstream_api_error',
      ...(detail?.trim() ? { detail: detail.trim().slice(0, 2000) } : {}),
    },
  })}\n\n`
}

/** 从 OpenAI 兼容 SSE 行解析 assistant 增量（与前端 readSseStream 对齐） */

export function parseSseDataLine(line: string): {
  text?: string
  reasoning?: string
  completionTokens?: number
} | null {
  const trimmed = line.trim()
  if (!trimmed.startsWith('data:')) return null
  const data = trimmed.slice(5).trim()
  if (data === '[DONE]') return null
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
    if (!d) return null
    const out: { text?: string; reasoning?: string; completionTokens?: number } =
      {}
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
    const completionTokens = extractCompletionTokens(j)
    if (completionTokens) out.completionTokens = completionTokens
    if (
      out.text !== undefined ||
      out.reasoning !== undefined ||
      out.completionTokens !== undefined
    ) {
      return out
    }
    return null
  } catch {
    return null
  }
}

/** 将上游 SSE 字节流解析为完整 assistant 正文 + 思维链 */
export async function accumulateAssistantFromSse(
  body: import('stream/web').ReadableStream<Uint8Array>,
): Promise<{ content: string; reasoning?: string }> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let content = ''
  let reasoning = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const parts = buffer.split('\n')
    buffer = parts.pop() ?? ''
    for (const line of parts) {
      const d = parseSseDataLine(line)
      if (!d) continue
      if (d.text) content += d.text
      if (d.reasoning) reasoning += d.reasoning
    }
  }
  const r = reasoning.trim()
  return { content, reasoning: r || undefined }
}
