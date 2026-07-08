import { getTurnUserText, type TurnRecord } from './chat-storage.js'
import {
  getActiveSegment,
  getTurnSegments,
  type AssistantSegmentRecord,
} from './group-chat-turn.js'
import {
  escapeXmlAttribute,
  prepareXmlElementText,
} from './prompt-xml.js'
import { flattenTurnsToChatMessages } from './prompt-macros/history-macros.js'

export function assistantTextFromTurn(
  t: TurnRecord,
  defaultSpeakerCharacterId = '',
): string {
  const seg = getActiveSegment(t, defaultSpeakerCharacterId)
  if (!seg) return ''
  const rs = seg.receives
  if (!Array.isArray(rs) || rs.length === 0) return ''
  const ai = Math.min(
    Math.max(0, Math.floor(seg.activeReceiveIndex) || 0),
    rs.length - 1,
  )
  const c = rs[ai]?.content
  return typeof c === 'string' ? c : ''
}

export function assistantTextFromSegment(seg: AssistantSegmentRecord): string {
  const rs = seg.receives ?? []
  if (rs.length === 0) return ''
  const ai = Math.min(
    Math.max(0, Math.floor(seg.activeReceiveIndex) || 0),
    rs.length - 1,
  )
  const c = rs[ai]?.content
  return typeof c === 'string' ? c : ''
}

/** 单条发言 XML（属性宏在组装/complete 阶段展开，与摘要 transcript 一致） */
export function wrapTurnRoleLine(
  role: 'user' | 'assistant',
  text: string,
): string {
  const body = (text ?? '').trim()
  if (!body) return ''
  const attr =
    role === 'user' ? 'userName="{{user}}"' : 'charName="{{char}}"'
  const escaped = prepareXmlElementText(body)
  return `<${role} ${attr}>${escaped}</${role}>`
}

function turnToXmlInner(
  turn: TurnRecord,
  opts?: {
    correlation?: number
    omitTurnId?: boolean
    defaultSpeakerCharacterId?: string
  },
): string {
  const user = getTurnUserText(turn)
  const defaultSpeaker = opts?.defaultSpeakerCharacterId?.trim() ?? ''
  const segments = getTurnSegments(turn, defaultSpeaker)
  const attrs: string[] = []
  if (!opts?.omitTurnId) {
    attrs.push(`id="${escapeXmlAttribute(turn.turnId)}"`)
  }
  attrs.push(`ordinal="${turn.turnOrdinal}"`)
  if (
    typeof opts?.correlation === 'number' &&
    Number.isFinite(opts.correlation)
  ) {
    attrs.push(`correlation="${opts.correlation.toFixed(4)}"`)
  }
  const lines: string[] = [`  <turn ${attrs.join(' ')}>`]
  if (user.trim()) {
    lines.push(`    ${wrapTurnRoleLine('user', user)}`)
  }
  for (const seg of segments) {
    const assistant = assistantTextFromSegment(seg).trim()
    if (assistant) {
      lines.push(`    ${wrapTurnRoleLine('assistant', assistant)}`)
    }
  }
  lines.push('  </turn>')
  return lines.join('\n')
}

export function formatHistoryXml(turns: TurnRecord[]): string {
  if (!turns.length) return ''
  const inner = turns.map((t) => turnToXmlInner(t)).join('\n')
  return `<history>\n${inner}\n</history>`
}

/** 近期 N 轮 → 组装用 user/assistant 消息链（非 XML）。 */
export function turnsToHistoryMessages(
  turns: TurnRecord[],
  opts?: {
    defaultSpeakerCharacterId?: string
    /** 指定 turn 内仅输出 segmentIndex < exclusive 的 segment */
    partialTurn?: { turnOrdinal: number; segmentIndexExclusive: number }
  },
): {
  role: 'user' | 'assistant'
  content: string
  turnId: string
  turnOrdinal: number
  receiveId?: string
  receiveIndex?: number
  segmentIndex?: number
  speakerCharacterId?: string
}[] {
  const defaultSpeaker = opts?.defaultSpeakerCharacterId?.trim() ?? ''
  const out: {
    role: 'user' | 'assistant'
    content: string
    turnId: string
    turnOrdinal: number
    receiveId?: string
    receiveIndex?: number
    segmentIndex?: number
    speakerCharacterId?: string
  }[] = []
  for (const turn of turns) {
    const user = getTurnUserText(turn).trim()
    if (user) {
      out.push({
        role: 'user',
        content: user,
        turnId: turn.turnId,
        turnOrdinal: turn.turnOrdinal,
      })
    }
    const segments = getTurnSegments(turn, defaultSpeaker)
    const partial =
      opts?.partialTurn?.turnOrdinal === turn.turnOrdinal
        ? opts.partialTurn.segmentIndexExclusive
        : segments.length
    const segLimit = Math.min(Math.max(0, partial), segments.length)
    for (let si = 0; si < segLimit; si++) {
      const seg = segments[si]!
      const assistant = assistantTextFromSegment(seg).trim()
      if (!assistant) continue
      const receives = seg.receives ?? []
      const activeIdx = Math.min(
        Math.max(0, Math.floor(seg.activeReceiveIndex) || 0),
        Math.max(0, receives.length - 1),
      )
      const rec = receives[activeIdx]
      out.push({
        role: 'assistant',
        content: assistant,
        turnId: turn.turnId,
        turnOrdinal: turn.turnOrdinal,
        segmentIndex: si,
        speakerCharacterId: seg.speakerCharacterId,
        ...(rec?.id ? { receiveId: rec.id } : {}),
        receiveIndex: activeIdx,
      })
    }
  }
  return out
}

/** 资料库关键字扫描语料（与 XML history 块正文等价，不含标签）。 */
export function turnsToHistoryScanPlainText(turns: TurnRecord[]): string {
  return turns
    .map((t) => turnEmbeddingCorpus(t))
    .filter((s) => s.length > 0)
    .join('\n\n')
}

export function formatMemoryXml(
  items: { turn: TurnRecord; score?: number }[],
): string {
  if (!items.length) return ''
  const sorted = items
    .slice()
    .sort((a, b) => a.turn.turnOrdinal - b.turn.turnOrdinal)
  const inner = sorted
    .map(({ turn, score }) =>
      turnToXmlInner(turn, { correlation: score, omitTurnId: true }),
    )
    .join('\n')
  return `<memory>\n${inner}\n</memory>`
}

/** 索引用：用户 + 助手正文拼接（资料库扫描等；memory 向量请用 buildMemoryEmbeddingCorpus） */
export function turnEmbeddingCorpus(
  turn: TurnRecord,
  defaultSpeakerCharacterId = '',
): string {
  const u = getTurnUserText(turn).trim()
  const segments = getTurnSegments(turn, defaultSpeakerCharacterId.trim())
  const assistantParts = segments
    .map((seg) => assistantTextFromSegment(seg).trim())
    .filter((x) => x.length > 0)
  const a = assistantParts.join('\n\n')
  return [u, a].filter((x) => x.length > 0).join('\n\n')
}

/**
 * 召回 query：上一轮助手 + 本轮用户（首条仅用户）。
 */
export function buildMemoryRecallQuery(
  userText: string,
  turns: TurnRecord[],
  beforeExclusive?: number | null,
): string {
  const user = userText.trim()
  let pool = turns.slice().sort((a, b) => a.turnOrdinal - b.turnOrdinal)
  if (
    typeof beforeExclusive === 'number' &&
    !Number.isNaN(beforeExclusive)
  ) {
    pool = pool.filter((t) => t.turnOrdinal < beforeExclusive)
  }
  const flat = flattenTurnsToChatMessages(pool)
  const lastAssistant = [...flat].reverse().find((m) => m.role === 'assistant')
  const assistant = lastAssistant?.content.trim() ?? ''
  const parts: string[] = []
  if (assistant) parts.push(assistant)
  if (user) parts.push(user)
  return parts.join('\n\n')
}
