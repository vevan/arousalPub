import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  auditEntryIdentityKey,
  auditEntryIsAfterSegment,
  auditEntryMatchesIdentity,
  normalizeAuditSegmentIndex,
} from '../src/chat-audit-identity.js'
import type { ChatAuditEntry } from '../src/chat-audit-types.js'

describe('chat-audit-identity', () => {
  it('normalizeAuditSegmentIndex defaults invalid to 0', () => {
    assert.equal(normalizeAuditSegmentIndex(undefined), 0)
    assert.equal(normalizeAuditSegmentIndex(-1), 0)
    assert.equal(normalizeAuditSegmentIndex(2), 2)
  })

  it('auditEntryIdentityKey distinguishes segments within same turn', () => {
    const k0 = auditEntryIdentityKey({ turnId: 't1', segmentIndex: 0 })
    const k1 = auditEntryIdentityKey({ turnId: 't1', segmentIndex: 1 })
    const kOther = auditEntryIdentityKey({ turnId: 't2', segmentIndex: 0 })
    assert.notEqual(k0, k1)
    assert.notEqual(k0, kOther)
  })

  it('auditEntryMatchesIdentity treats missing segmentIndex as 0', () => {
    const entry = {
      turnId: 't1',
      segmentIndex: undefined,
    } as ChatAuditEntry
    assert.equal(auditEntryMatchesIdentity(entry, { turnId: 't1', segmentIndex: 0 }), true)
    assert.equal(auditEntryMatchesIdentity(entry, { turnId: 't1', segmentIndex: 1 }), false)
  })

  it('auditEntryIsAfterSegment identifies later segments only', () => {
    const entry = { turnId: 't1', segmentIndex: 2 } as ChatAuditEntry
    assert.equal(auditEntryIsAfterSegment(entry, { turnId: 't1', segmentIndex: 1 }), true)
    assert.equal(auditEntryIsAfterSegment(entry, { turnId: 't1', segmentIndex: 2 }), false)
    assert.equal(auditEntryIsAfterSegment(entry, { turnId: 't2', segmentIndex: 1 }), false)
  })
})
