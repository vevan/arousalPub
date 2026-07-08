import type { ChatAuditEntry } from './chat-audit-types.js'

export function requireAuditSegmentIndex(segmentIndex: number | undefined): number {
  if (
    typeof segmentIndex !== 'number' ||
    !Number.isInteger(segmentIndex) ||
    segmentIndex < 0
  ) {
    throw new Error('audit_segment_index_required')
  }
  return segmentIndex
}

function auditSegmentIndexForKey(segmentIndex: number | undefined): number | null {
  if (
    typeof segmentIndex !== 'number' ||
    !Number.isInteger(segmentIndex) ||
    segmentIndex < 0
  ) {
    return null
  }
  return segmentIndex
}

/** 同一 turn 内按 segment 区分审计条目 */
export function auditEntryIdentityKey(
  entry: Pick<ChatAuditEntry, 'turnId' | 'segmentIndex'>,
): string {
  const seg = auditSegmentIndexForKey(entry.segmentIndex)
  return `${entry.turnId}\0${seg ?? 'none'}`
}

export function auditEntryMatchesIdentity(
  entry: ChatAuditEntry,
  params: { turnId: string; segmentIndex: number },
): boolean {
  const seg = auditSegmentIndexForKey(entry.segmentIndex)
  if (seg === null) return false
  return entry.turnId === params.turnId && seg === params.segmentIndex
}

export function auditEntryIsAfterSegment(
  entry: ChatAuditEntry,
  params: { turnId: string; segmentIndex: number },
): boolean {
  const seg = auditSegmentIndexForKey(entry.segmentIndex)
  if (seg === null) return false
  return entry.turnId === params.turnId && seg > params.segmentIndex
}
