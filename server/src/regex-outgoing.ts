import type { ChatMessage } from './assemble-prompts.js'
import type { TurnRecord } from './chat-storage.js'
import { getTurnUserText } from './chat-storage.js'
import { getTurnSegments } from './group-chat-turn.js'
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
  assistantTextFromSegment,
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

export type OutgoingRegexTurnOptions = ApplyRegexOptions & {
  regexApplyAllTurns?: boolean
}

/** 对单 turn 全部 segment 的 user/assistant 应用 outgoing（含 skipLastNTurns） */
export function applyOutgoingRegexToTurnRecord(
  turn: TurnRecord,
  rules: RegexRule[],
  tailOrdinal: number,
  opts?: OutgoingRegexTurnOptions,
): TurnRecord {
  const outgoingRules = filterRegexRules(rules, { phases: ['outgoing'] })
  if (!hasEnabledOutgoingRules(outgoingRules)) return turn

  const ord = turn.turnOrdinal
  const skipTailOrdinal = resolveOutgoingSkipTailOrdinal(tailOrdinal)
  const regexCtxBase = {
    phase: 'outgoing' as const,
    tailOrdinal: skipTailOrdinal,
    ...(opts?.regexApplyAllTurns ? { ignoreSkipLastNTurns: true as const } : {}),
  }
  let userText = normalizeXmlTextBeforeProcessing(getTurnUserText(turn))
  let userChanged = false
  if (userText.trim()) {
    const next = applyRegexRulesToText(
      userText,
      outgoingRules,
      { ...regexCtxBase, field: 'user', turnOrdinal: ord },
      opts,
    )
    if (next !== userText) {
      userText = next
      userChanged = true
    }
  }

  const segments = getTurnSegments(turn, '')
  let segmentsChanged = false
  const nextSegments = turn.segments.map((rawSeg, si) => {
    const seg = segments[si]
    if (!seg) return rawSeg
    let assistant = normalizeXmlTextBeforeProcessing(
      assistantTextFromSegment(seg),
    )
    if (!assistant.trim()) return rawSeg
    const next = applyRegexRulesToText(
      assistant,
      outgoingRules,
      { ...regexCtxBase, field: 'assistant', turnOrdinal: ord },
      opts,
    )
    if (next === assistant) return rawSeg
    segmentsChanged = true
    const receives = [...rawSeg.receives]
    const activeIdx = Math.min(
      Math.max(0, Math.floor(rawSeg.activeReceiveIndex) || 0),
      Math.max(0, receives.length - 1),
    )
    if (receives[activeIdx]) {
      receives[activeIdx] = { ...receives[activeIdx], content: next }
    }
    return { ...rawSeg, receives }
  })

  if (!userChanged && !segmentsChanged) return turn

  let next: TurnRecord = userChanged ? { ...turn, send: { userText } } : { ...turn }
  if (segmentsChanged) {
    next = { ...next, segments: nextSegments }
  }
  return next
}

/** 对 memory 块内各轮 user/assistant 按 turnOrdinal 应用 outgoing（含 skipLastNTurns） */
export function applyOutgoingRegexToMemoryItems(
  items: MemoryRegexItem[],
  rules: RegexRule[],
  tailOrdinal: number,
  opts?: OutgoingRegexTurnOptions,
): MemoryRegexItem[] {
  const outgoingRules = filterRegexRules(rules, { phases: ['outgoing'] })
  if (!hasEnabledOutgoingRules(outgoingRules) || items.length === 0) {
    return items
  }

  return items.map(({ turn, score }) => ({
    turn: applyOutgoingRegexToTurnRecord(turn, outgoingRules, tailOrdinal, opts),
    ...(typeof score === 'number' ? { score } : {}),
  }))
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

/** history 条 → turnOrdinal；群聊同 turn 多 assistant 时优先读 message.turnOrdinal */
export function buildPerMessageTurnOrdinals(
  historyMessages: ChatMessage[],
  turnOrdinals: number[],
): number[] {
  const roleMessages = historyMessages.filter(
    (m) => m.role === 'user' || m.role === 'assistant',
  )
  if (
    roleMessages.length > 0 &&
    roleMessages.every(
      (m) =>
        typeof m.turnOrdinal === 'number' && Number.isFinite(m.turnOrdinal),
    )
  ) {
    return roleMessages.map((m) => m.turnOrdinal as number)
  }

  const out: number[] = []
  let msgIdx = 0
  for (const ord of turnOrdinals) {
    if (
      msgIdx < roleMessages.length &&
      roleMessages[msgIdx]?.role === 'user'
    ) {
      out.push(ord)
      msgIdx++
    }
    if (
      msgIdx < roleMessages.length &&
      roleMessages[msgIdx]?.role === 'assistant'
    ) {
      out.push(ord)
      msgIdx++
    }
  }
  while (msgIdx < roleMessages.length) {
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
