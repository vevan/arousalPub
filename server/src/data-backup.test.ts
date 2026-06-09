import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  evaluateBackupSchedule,
  type BackupManifest,
} from './data-backup.js'
import type { BackupSettings } from './backup-config.js'

const baseSettings: BackupSettings = {
  enabled: true,
  intervalDays: 7,
  maxKept: 5,
  retryHours: 24,
}

describe('evaluateBackupSchedule', () => {
  it('returns false when disabled or already running', () => {
    assert.equal(
      evaluateBackupSchedule(
        { ...baseSettings, enabled: false },
        {},
        Date.now(),
        false,
      ),
      false,
    )
    assert.equal(
      evaluateBackupSchedule(baseSettings, {}, Date.now(), true),
      false,
    )
  })

  it('returns true when never backed up', () => {
    assert.equal(
      evaluateBackupSchedule(baseSettings, {}, Date.now(), false),
      true,
    )
  })

  it('returns false within retry window after failure', () => {
    const now = Date.parse('2026-06-08T12:00:00.000Z')
    const manifest: BackupManifest = {
      lastFailedAt: '2026-06-08T10:00:00.000Z',
      lastError: 'disk full',
    }
    assert.equal(
      evaluateBackupSchedule(baseSettings, manifest, now, false),
      false,
    )
  })

  it('returns false after retry window when last success is still within interval', () => {
    const now = Date.parse('2026-06-09T11:00:00.000Z')
    const manifest: BackupManifest = {
      lastSuccessAt: '2026-06-09T10:00:00.000Z',
      lastFailedAt: '2026-06-08T10:00:00.000Z',
    }
    assert.equal(
      evaluateBackupSchedule(baseSettings, manifest, now, false),
      false,
    )
  })

  it('returns true after retry window when last success is older than interval', () => {
    const now = Date.parse('2026-06-09T11:00:00.000Z')
    const manifest: BackupManifest = {
      lastSuccessAt: '2026-06-01T00:00:00.000Z',
      lastFailedAt: '2026-06-08T10:00:00.000Z',
    }
    assert.equal(
      evaluateBackupSchedule(baseSettings, manifest, now, false),
      true,
    )
  })

  it('returns false before interval days since last success', () => {
    const now = Date.parse('2026-06-05T00:00:00.000Z')
    const manifest: BackupManifest = {
      lastSuccessAt: '2026-06-01T00:00:00.000Z',
    }
    assert.equal(
      evaluateBackupSchedule(baseSettings, manifest, now, false),
      false,
    )
  })

  it('returns true on or after interval days since last success', () => {
    const now = Date.parse('2026-06-08T00:00:00.000Z')
    const manifest: BackupManifest = {
      lastSuccessAt: '2026-06-01T00:00:00.000Z',
    }
    assert.equal(
      evaluateBackupSchedule(baseSettings, manifest, now, false),
      true,
    )
  })
})
