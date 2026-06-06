import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isLoopbackAddress } from './localhost.js'

describe('isLoopbackAddress', () => {
  it('accepts IPv4 and IPv6 loopback', () => {
    assert.equal(isLoopbackAddress('127.0.0.1'), true)
    assert.equal(isLoopbackAddress('::1'), true)
    assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true)
  })

  it('rejects remote addresses', () => {
    assert.equal(isLoopbackAddress('192.168.1.1'), false)
    assert.equal(isLoopbackAddress('10.0.0.1'), false)
    assert.equal(isLoopbackAddress(undefined), false)
    assert.equal(isLoopbackAddress(''), false)
  })
})
