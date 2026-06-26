import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  isClientIpAllowed,
  isLoopbackAddress,
  matchIpWhitelistPattern,
} from '../src/client-ip.js'

describe('isLoopbackAddress', () => {
  it('accepts IPv4 and IPv6 loopback', () => {
    assert.equal(isLoopbackAddress('127.0.0.1'), true)
    assert.equal(isLoopbackAddress('::1'), true)
    assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  })

  it('rejects remote addresses', () => {
    assert.equal(isLoopbackAddress('192.168.1.1'), false)
  })
})

describe('matchIpWhitelistPattern', () => {
  it('matches exact and wildcard octets', () => {
    assert.equal(matchIpWhitelistPattern('192.168.1.42', '192.168.1.*'), true)
    assert.equal(matchIpWhitelistPattern('100.64.1.2', '100.*.*.*'), true)
    assert.equal(matchIpWhitelistPattern('10.0.0.1', '192.168.1.*'), false)
  })
})

describe('isClientIpAllowed', () => {
  it('allows all when whitelist empty', () => {
    assert.equal(isClientIpAllowed('8.8.8.8', []), true)
  })

  it('always allows loopback when whitelist non-empty', () => {
    assert.equal(isClientIpAllowed('127.0.0.1', ['192.168.1.*']), true)
  })

  it('enforces patterns', () => {
    const wl = ['192.168.0.*', '192.168.1.*']
    assert.equal(isClientIpAllowed('192.168.1.5', wl), true)
    assert.equal(isClientIpAllowed('8.8.8.8', wl), false)
  })
})
