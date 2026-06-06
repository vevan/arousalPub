import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  acquireMaintenanceLock,
  releaseMaintenanceLock,
  shouldBlockWriteForMaintenance,
} from './maintenance-lock.js'

describe('maintenance-lock', () => {
  it('blocks api writes but not admin/auth', () => {
    acquireMaintenanceLock('dek_rotation')
    try {
      assert.equal(
        shouldBlockWriteForMaintenance('POST', '/api/chat/abc123/turn'),
        true,
      )
      assert.equal(
        shouldBlockWriteForMaintenance('PUT', '/api/settings'),
        true,
      )
      assert.equal(
        shouldBlockWriteForMaintenance('GET', '/api/settings'),
        false,
      )
      assert.equal(
        shouldBlockWriteForMaintenance('POST', '/api/admin/users'),
        false,
      )
      assert.equal(
        shouldBlockWriteForMaintenance('POST', '/api/auth/login'),
        false,
      )
    } finally {
      releaseMaintenanceLock()
    }
  })
})
