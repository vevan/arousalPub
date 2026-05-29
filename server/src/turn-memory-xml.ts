import { getTurnUserText, type TurnRecord } from './chat-storage.js'

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export function assistantTextFromTurn(t: TurnRecord): string {
  const rs = t.receives
  if (!Array.isArray(rs) || rs.length === 0) return ''
  const ai = Math.min(
    Math.max(0, Math.floor(t.activeReceiveIndex) || 0),
    rs.length - 1,
  )
  const c = rs[ai]?.content
  return typeof c === 'string' ? c : ''
}

function turnToXmlInner(turn: TurnRecord, score?: number): string {
  const user = getTurnUserText(turn)
  const assistant = assistantTextFromTurn(turn)
  const scoreAttr =
    typeof score === 'number' && Number.isFinite(score)
      ? ` score="${score.toFixed(4)}"`
      : ''
  const lines: string[] = [
    `  <turn id="${escapeXml(turn.turnId)}" ordinal="${turn.turnOrdinal}"${scoreAttr}>`,
  ]
  if (user.trim()) {
    lines.push(`    <user>${escapeXml(user)}</user>`)
  }
  if (assistant.trim()) {
    lines.push(`    <assistant>${escapeXml(assistant)}</assistant>`)
  }
  lines.push('  </turn>')
  return lines.join('\n')
}

export function formatHistoryXml(turns: TurnRecord[]): string {
  if (!turns.length) return ''
  const inner = turns.map((t) => turnToXmlInner(t)).join('\n')
  return `<history>\n${inner}\n</history>`
}

export function formatMemoryXml(
  items: { turn: TurnRecord; score?: number }[],
): string {
  if (!items.length) return ''
  const sorted = items
    .slice()
    .sort((a, b) => a.turn.turnOrdinal - b.turn.turnOrdinal)
  const inner = sorted
    .map(({ turn, score }) => turnToXmlInner(turn, score))
    .join('\n')
  return `<memory>\n${inner}\n</memory>`
}

/** 索引用：用户 + 助手正文拼接 */
export function turnEmbeddingCorpus(turn: TurnRecord): string {
  const u = getTurnUserText(turn).trim()
  const a = assistantTextFromTurn(turn).trim()
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
  const last = pool.length > 0 ? pool[pool.length - 1] : null
  const assistant = last ? assistantTextFromTurn(last).trim() : ''
  const parts: string[] = []
  if (assistant) parts.push(assistant)
  if (user) parts.push(user)
  return parts.join('\n\n')
}
