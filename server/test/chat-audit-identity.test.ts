import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  auditEntryIdentityKey,
  auditEntryIsAfterSegment,
  auditEntryMatchesIdentity,
  requireAuditSegmentIndex,
} from '../src/chat-audit-identity.js'
import type { ChatAuditEntry } from '../src/chat-audit-types.js'

describe('chat-audit-identity', () => {
  it('requireAuditSegmentIndex rejects invalid values', () => {
    assert.throws(() => requireAuditSegmentIndex(undefined), /audit_segment_index_required/)
    assert.throws(() => requireAuditSegmentIndex(-1), /audit_segment_index_required/)
    assert.equal(requireAuditSegmentIndex(2), 2)
  })

  it('auditEntryIdentityKey distinguishes segment indices', () => {
    const k0 = auditEntryIdentityKey({ turnId: 't1', segmentIndex: 0 })
    const k1 = auditEntryIdentityKey({ turnId: 't1', segmentIndex: 1 })
    const kOther = auditEntryIdentityKey({ turnId: 't2', segmentIndex: 0 })
    assert.notEqual(k0, k1)
    assert.notEqual(k0, kOther)
  })

  it('auditEntryMatchesIdentity ignores entries without segmentIndex', () => {
    const entry = {
      turnId: 't1',
      segmentIndex: undefined,
    } as ChatAuditEntry
    assert.equal(auditEntryMatchesIdentity(entry, { turnId: 't1', segmentIndex: 0 }), false)
    assert.equal(auditEntryMatchesIdentity(entry, { turnId: 't1', segmentIndex: 1 }), false)
  })

  it('auditEntryIsAfterSegment compares segment ordinals', () => {
    const entry = { turnId: 't1', segmentIndex: 2 } as ChatAuditEntry
    assert.equal(auditEntryIsAfterSegment(entry, { turnId: 't1', segmentIndex: 1 }), true)
    assert.equal(auditEntryIsAfterSegment(entry, { turnId: 't1', segmentIndex: 2 }), false)
    assert.equal(auditEntryIsAfterSegment(entry, { turnId: 't2', segmentIndex: 1 }), false)
  })
})
