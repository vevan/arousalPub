import type { ChatMessage } from './assemble-prompts.js'
import {
  applyRegexRulesToMessages,
  filterRegexRules,
  type ApplyRegexOptions,
} from './regex-apply.js'
import { readRegexRulesDocument } from './regex-rules-file.js'
import type { RegexRule } from './regex-rules-types.js'

export interface OutgoingRegexContext {
  tailOrdinal: number
  /** memory pipeline 全量 history（裁切前） */
  sourceHistoryMessages: ChatMessage[]
  /** 对应每轮的 turnOrdinal */
  sourceHistoryTurnOrdinals: number[]
  /** budget trim 后的 history（与组装 messages 中 history 段一致） */
  trimmedHistoryMessages: ChatMessage[]
  /** 本轮 userInput；用于识别尾部当前 user 消息 */
  userInput?: string
}

export function resolveOutgoingTailOrdinal(params: {
  sourceHistoryTurnOrdinals: number[]
  historyBeforeTurnOrdinalExclusive?: number | null
}): number {
  const before = params.historyBeforeTurnOrdinalExclusive
  if (typeof before === 'number' && Number.isFinite(before) && before >= 0) {
    return Math.trunc(before)
  }
  if (params.sourceHistoryTurnOrdinals.length === 0) return 0
  return Math.max(...params.sourceHistoryTurnOrdinals) + 1
}

export function hasEnabledOutgoingRules(rules: RegexRule[]): boolean {
  return rules.some((r) => r.enabled && r.phases.includes('outgoing'))
}

/** 每轮 0–2 条 message（user / assistant）对应同一 turnOrdinal */
export function buildPerMessageTurnOrdinals(
  historyMessages: ChatMessage[],
  turnOrdinals: number[],
): number[] {
  const out: number[] = []
  let msgIdx = 0
  for (const ord of turnOrdinals) {
    if (
      msgIdx < historyMessages.length &&
      historyMessages[msgIdx]?.role === 'user'
    ) {
      out.push(ord)
      msgIdx++
    }
    if (
      msgIdx < historyMessages.length &&
      historyMessages[msgIdx]?.role === 'assistant'
    ) {
      out.push(ord)
      msgIdx++
    }
  }
  while (msgIdx < historyMessages.length) {
    const lastOrd = turnOrdinals[turnOrdinals.length - 1]
    out.push(typeof lastOrd === 'number' ? lastOrd : 0)
    msgIdx++
  }
  return out
}

function ordinalsForTrimmedHistory(
  trimmed: ChatMessage[],
  source: ChatMessage[],
  sourceTurnOrdinals: number[],
): number[] {
  const full = buildPerMessageTurnOrdinals(source, sourceTurnOrdinals)
  if (trimmed.length === 0) return []
  if (trimmed.length === source.length) return full
  const offset = source.length - trimmed.length
  if (offset < 0) return full.slice(0, trimmed.length)
  for (let i = 0; i < trimmed.length; i++) {
    const s = source[offset + i]
    const t = trimmed[i]
    if (!s || s.role !== t.role || s.content !== t.content) {
      return buildPerMessageTurnOrdinals(trimmed, sourceTurnOrdinals.slice(-trimmed.length))
    }
  }
  return full.slice(offset)
}

export function findHistorySpanInMessages(
  messages: ChatMessage[],
  historyMessages: ChatMessage[],
): { start: number; length: number } | null {
  if (historyMessages.length === 0) return null
  outer: for (let i = 0; i <= messages.length - historyMessages.length; i++) {
    for (let j = 0; j < historyMessages.length; j++) {
      const a = messages[i + j]
      const b = historyMessages[j]
      if (!a || !b || a.role !== b.role || a.content !== b.content) {
        continue outer
      }
    }
    return { start: i, length: historyMessages.length }
  }
  return null
}

function turnOrdinalForMessageIndex(
  index: number,
  msg: ChatMessage,
  ctx: OutgoingRegexContext,
  historySpan: { start: number; length: number } | null,
  trimmedOrdinals: number[],
): number | undefined {
  if (historySpan && index >= historySpan.start) {
    const rel = index - historySpan.start
    if (rel < historySpan.length) {
      return trimmedOrdinals[rel]
    }
  }
  const userText = ctx.userInput?.trim() ?? ''
  if (userText && msg.role === 'user' && msg.content === userText) {
    return ctx.tailOrdinal
  }
  return undefined
}

export function applyRegexOutgoingToMessages(
  messages: ChatMessage[],
  rules: RegexRule[],
  ctx: OutgoingRegexContext,
  opts?: ApplyRegexOptions,
): ChatMessage[] {
  const outgoingRules = filterRegexRules(rules, { phases: ['outgoing'] })
  if (!hasEnabledOutgoingRules(outgoingRules)) return messages

  const trimmedOrdinals = ordinalsForTrimmedHistory(
    ctx.trimmedHistoryMessages,
    ctx.sourceHistoryMessages,
    ctx.sourceHistoryTurnOrdinals,
  )
  const historySpan = findHistorySpanInMessages(messages, ctx.trimmedHistoryMessages)

  return applyRegexRulesToMessages(
    messages,
    outgoingRules,
    {
      phase: 'outgoing',
      tailOrdinal: ctx.tailOrdinal,
      turnOrdinalByIndex: (index, msg) =>
        turnOrdinalForMessageIndex(
          index,
          msg,
          ctx,
          historySpan,
          trimmedOrdinals,
        ),
    },
    opts,
  )
}

export async function loadAndApplyRegexOutgoing(
  messages: ChatMessage[],
  ctx: OutgoingRegexContext,
  opts?: ApplyRegexOptions,
): Promise<ChatMessage[]> {
  const doc = await readRegexRulesDocument()
  if (!hasEnabledOutgoingRules(doc.rules)) return messages
  return applyRegexOutgoingToMessages(messages, doc.rules, ctx, opts)
}
