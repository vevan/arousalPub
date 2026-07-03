import type { ChatAuditEntry } from './chat-audit-types.js'

export function normalizeAuditSegmentIndex(segmentIndex: number | undefined): number {
  return typeof segmentIndex === 'number' && Number.isInteger(segmentIndex) && segmentIndex >= 0
    ? segmentIndex
    : 0
}

/** 同一 turn 内按 segment 区分审计条目 */
export function auditEntryIdentityKey(entry: Pick<ChatAuditEntry, 'turnId' | 'segmentIndex'>): string {
  return `${entry.turnId}\0${normalizeAuditSegmentIndex(entry.segmentIndex)}`
}

export function auditEntryMatchesIdentity(
  entry: ChatAuditEntry,
  params: { turnId: string; segmentIndex: number },
): boolean {
  return (
    entry.turnId === params.turnId &&
    normalizeAuditSegmentIndex(entry.segmentIndex) === params.segmentIndex
  )
}

export function auditEntryIsAfterSegment(
  entry: ChatAuditEntry,
  params: { turnId: string; segmentIndex: number },
): boolean {
  return (
    entry.turnId === params.turnId &&
    normalizeAuditSegmentIndex(entry.segmentIndex) > params.segmentIndex
  )
}
