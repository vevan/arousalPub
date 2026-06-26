import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { pluginAuthFailureStatus } from '../src/plugin-route-auth.js'

describe('pluginAuthFailureStatus', () => {
  it('maps not found to 404', () => {
    assert.equal(pluginAuthFailureStatus('plugin_not_found'), 404)
  })

  it('maps disabled and permission denied to 403', () => {
    assert.equal(pluginAuthFailureStatus('plugin_disabled'), 403)
    assert.equal(pluginAuthFailureStatus('plugin_permission_denied'), 403)
  })
})
