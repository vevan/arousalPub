import type { ChatMessage } from './assemble-prompts.js'
import type { TurnRecord } from './chat-storage.js'
import { getTurnUserText } from './chat-storage.js'
import { applyPromptMacroPipeline } from './prompt-macros/index.js'
import type { PromptMacroContext } from './prompt-macros/index.js'
import {
  applyRegexRulesToMessages,
  applyRegexRulesToText,
  filterRegexRules,
  type ApplyRegexOptions,
} from './regex-apply.js'
import { readRegexRulesDocument } from './regex-rules-file.js'
import type { RegexRule } from './regex-rules-types.js'
import { normalizeXmlTextBeforeProcessing } from './prompt-xml.js'
import {
  assistantTextFromTurn,
  formatMemoryXml,
} from './turn-memory-xml.js'

export interface MemoryRegexItem {
  turn: TurnRecord
  score?: number
}

export interface OutgoingRegexContext {
  tailOrdinal: number
  /** memory pipeline 全量 history（裁切前） */
  sourceHistoryMessages: ChatMessage[]
  /** 对应每轮的 turnOrdinal */
  sourceHistoryTurnOrdinals: number[]
  /** budget trim 后的 history（与组装 messages 中 history 段一致） */
  trimmedHistoryMessages: ChatMessage[]
  /** budget trim 后的 memory 召回项（与组装 messages 中 memory 块一致） */
  memoryItems?: MemoryRegexItem[]
  /** 本轮 userInput；用于识别尾部当前 user 消息 */
  userInput?: string
  /** memory 块重建后重新展开 `{{user}}` / `{{char}}` 等 */
  macroContext?: PromptMacroContext
}

export function isMemoryXmlContent(content: string): boolean {
  return content.trimStart().startsWith('<memory>')
}

function patchTurnRecordContent(
  turn: TurnRecord,
  userText: string,
  assistantContent: string,
): TurnRecord {
  const userChanged = getTurnUserText(turn) !== userText
  const assistantChanged = assistantTextFromTurn(turn) !== assistantContent
  if (!userChanged && !assistantChanged) return turn

  const receives = [...(turn.receives ?? [])]
  const activeIdx = Math.min(
    Math.max(0, Math.floor(turn.activeReceiveIndex) || 0),
    Math.max(0, receives.length - 1),
  )
  if (receives[activeIdx]) {
    receives[activeIdx] = { ...receives[activeIdx], content: assistantContent }
  }
  return {
    ...turn,
    send: { ...turn.send, userText },
    receives,
  }
}

/** 对 memory 块内各轮 user/assistant 按 turnOrdinal 应用 outgoing（含 skipLastNTurns） */
export function applyOutgoingRegexToMemoryItems(
  items: MemoryRegexItem[],
  rules: RegexRule[],
  tailOrdinal: number,
  opts?: ApplyRegexOptions,
): MemoryRegexItem[] {
  const outgoingRules = filterRegexRules(rules, { phases: ['outgoing'] })
  if (!hasEnabledOutgoingRules(outgoingRules) || items.length === 0) {
    return items
  }

  const skipTailOrdinal = resolveOutgoingSkipTailOrdinal(tailOrdinal)

  return items.map(({ turn, score }) => {
    const ord = turn.turnOrdinal
    const userText = applyRegexRulesToText(
      normalizeXmlTextBeforeProcessing(getTurnUserText(turn)),
      outgoingRules,
      {
        phase: 'outgoing',
        field: 'user',
        turnOrdinal: ord,
        tailOrdinal: skipTailOrdinal,
      },
      opts,
    )
    const assistantContent = applyRegexRulesToText(
      normalizeXmlTextBeforeProcessing(assistantTextFromTurn(turn)),
      outgoingRules,
      {
        phase: 'outgoing',
        field: 'assistant',
        turnOrdinal: ord,
        tailOrdinal: skipTailOrdinal,
      },
      opts,
    )
    return {
      turn: patchTurnRecordContent(turn, userText, assistantContent),
      ...(typeof score === 'number' ? { score } : {}),
    }
  })
}

function patchMemoryMessagesInPlace(
  messages: ChatMessage[],
  memoryXml: string,
  macroContext?: PromptMacroContext,
): ChatMessage[] {
  let patched = false
  const content =
    macroContext && memoryXml.includes('{{')
      ? applyPromptMacroPipeline(memoryXml, macroContext)
      : memoryXml
  const out = messages.map((msg) => {
    if (msg.role === 'system' && isMemoryXmlContent(msg.content)) {
      patched = true
      return { ...msg, content }
    }
    return msg
  })
  return patched ? out : messages
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

/**
 * skipLastNTurns 锚点：最后一条会进入 prompt 的 assistant 所在轮次。
 * 普通发送 tail=max+1（尾部 user 无 assistant）；再生 tail=当前轮（assistant 未发出）→ 均为 tail−1。
 */
export function resolveOutgoingSkipTailOrdinal(tailOrdinal: number): number {
  return Math.max(0, tailOrdinal - 1)
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
  if (
    (msg.role === 'user' || msg.role === 'assistant') &&
    typeof msg.turnOrdinal === 'number' &&
    Number.isFinite(msg.turnOrdinal)
  ) {
    return msg.turnOrdinal
  }
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

  let messagesForRules = messages
  if (ctx.memoryItems && ctx.memoryItems.length > 0) {
    const processedItems = applyOutgoingRegexToMemoryItems(
      ctx.memoryItems,
      outgoingRules,
      ctx.tailOrdinal,
      opts,
    )
    const memoryXml = formatMemoryXml(processedItems)
    if (memoryXml) {
      messagesForRules = patchMemoryMessagesInPlace(
        messages,
        memoryXml,
        ctx.macroContext,
      )
    }
  }

  const trimmedOrdinals = ordinalsForTrimmedHistory(
    ctx.trimmedHistoryMessages,
    ctx.sourceHistoryMessages,
    ctx.sourceHistoryTurnOrdinals,
  )
  const historySpan = findHistorySpanInMessages(messages, ctx.trimmedHistoryMessages)
  const skipTailOrdinal = resolveOutgoingSkipTailOrdinal(ctx.tailOrdinal)

  return applyRegexRulesToMessages(
    messagesForRules,
    outgoingRules,
    {
      phase: 'outgoing',
      tailOrdinal: skipTailOrdinal,
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
