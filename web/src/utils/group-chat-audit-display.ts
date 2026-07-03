import type { GroupChatDiceBidAuditRow, GroupChatSpeakerAudit } from '@/types/chat-turn'

function isDiceBidEligible(row: GroupChatDiceBidAuditRow): boolean {
  if (typeof row.eligible === 'boolean') return row.eligible
  return typeof row.roll === 'number'
}

export function sortGroupChatDiceBids(
  bids: GroupChatDiceBidAuditRow[],
): GroupChatDiceBidAuditRow[] {
  return [...bids].sort((a, b) => {
    const aEligible = isDiceBidEligible(a)
    const bEligible = isDiceBidEligible(b)
    if (aEligible !== bEligible) return aEligible ? -1 : 1
    const scoreA = a.score ?? -1
    const scoreB = b.score ?? -1
    if (scoreB !== scoreA) return scoreB - scoreA
    return a.characterId.localeCompare(b.characterId)
  })
}

export function isGroupChatDiceBidEligible(row: GroupChatDiceBidAuditRow): boolean {
  return isDiceBidEligible(row)
}

/** 展示用段序号：优先 dice.segmentCount+1，否则 segmentIndex+1 */
export function groupChatAuditSegmentLabel(
  audit: GroupChatSpeakerAudit | null | undefined,
): number | null {
  if (!audit) return null
  const fromDice = audit.dice?.segmentCount
  if (typeof fromDice === 'number' && Number.isFinite(fromDice)) {
    return fromDice + 1
  }
  if (typeof audit.segmentIndex === 'number' && Number.isFinite(audit.segmentIndex)) {
    return audit.segmentIndex + 1
  }
  return null
}

export function groupChatAuditMaxSegments(
  audit: GroupChatSpeakerAudit | null | undefined,
): number | null {
  const n = audit?.maxSegmentsPerTurn
  return typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : null
}
