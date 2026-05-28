/**
 * OpenAI Chat Completions 消息 token 计数（js-tiktoken / lite 词表）。
 * @see https://github.com/openai/openai-cookbook/blob/main/examples/How_to_count_tokens_with_tiktoken.ipynb
 */
import { Tiktoken } from 'js-tiktoken/lite'
import cl100k_base from 'js-tiktoken/ranks/cl100k_base'
import o200k_base from 'js-tiktoken/ranks/o200k_base'

export const DEFAULT_TOKEN_MODEL = 'gpt-4o'

export type TiktokenEncodingName = 'o200k_base' | 'cl100k_base'

export interface TokenCountOptions {
  /** OpenAI 风格模型名，用于选择 cl100k / o200k 词表 */
  model?: string
}

let o200kEnc: Tiktoken | null = null
let cl100kEnc: Tiktoken | null = null

/** 按模型名选择 tiktoken 词表 */
export function encodingNameForModel(model?: string): TiktokenEncodingName {
  const m = (model ?? DEFAULT_TOKEN_MODEL).toLowerCase()
  if (
    m.includes('gpt-4o') ||
    m.includes('gpt-4.1') ||
    m.includes('gpt-5') ||
    m.includes('o1') ||
    m.includes('o3') ||
    m.includes('o4') ||
    m.includes('chatgpt-4o')
  ) {
    return 'o200k_base'
  }
  if (
    m.includes('gpt-4') ||
    m.includes('gpt-3.5') ||
    m.includes('gpt-35') ||
    m.includes('text-davinci')
  ) {
    return 'cl100k_base'
  }
  return 'o200k_base'
}

function getEncoder(name: TiktokenEncodingName): Tiktoken {
  if (name === 'cl100k_base') {
    cl100kEnc ??= new Tiktoken(cl100k_base)
    return cl100kEnc
  }
  o200kEnc ??= new Tiktoken(o200k_base)
  return o200kEnc
}

function charLengthFallback(text: string): number {
  return Math.max(1, Math.ceil(text.length / 3.5))
}

/** 单段文本 token 数 */
export function estimateTokens(text: string, options?: TokenCountOptions): number {
  if (!text) return 0
  try {
    const enc = getEncoder(encodingNameForModel(options?.model))
    return enc.encode(text).length
  } catch {
    return charLengthFallback(text)
  }
}

/** Chat Completions messages 数组（含每条固定开销与 assistant  priming） */
export function countChatMessagesTokens(
  messages: readonly { role: string; content: string; name?: string }[],
  options?: TokenCountOptions,
): number {
  try {
    const enc = getEncoder(encodingNameForModel(options?.model))
    const tokensPerMessage = 3
    const tokensPerName = 1
    let n = 0
    for (const msg of messages) {
      n += tokensPerMessage
      n += enc.encode(msg.role).length
      n += enc.encode(msg.content ?? '').length
      if (msg.name) {
        n += tokensPerName
        n += enc.encode(msg.name).length
      }
    }
    n += 3
    return n
  } catch {
    let total = 0
    for (const m of messages) {
      total += estimateTokens(m.content, options) + 4
    }
    return total + 2
  }
}
