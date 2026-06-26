import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  assertUpstreamBaseUrlAllowed,
  assertUpstreamUrlAllowed,
  UpstreamUrlBlockedError,
} from '../src/upstream-url-guard.js'

describe('assertUpstreamUrlAllowed', () => {
  it('allows any host when policy is open', () => {
    assertUpstreamUrlAllowed('http://127.0.0.1:11434/v1', 'open')
    assertUpstreamUrlAllowed('http://2130706433/', 'open')
  })

  it('allows public HTTPS endpoints in public-only', () => {
    assertUpstreamUrlAllowed('https://api.openai.com/v1', 'public-only')
    assertUpstreamUrlAllowed('https://example.com/chat/completions', 'public-only')
  })

  it('rejects loopback and RFC1918 in public-only', () => {
    for (const url of [
      'http://127.0.0.1:11434/v1',
      'http://localhost/v1',
      'http://192.168.1.1/v1',
      'http://10.0.0.1/v1',
      'http://[::1]/v1',
      'http://169.254.169.254/',
    ]) {
      assert.throws(
        () => assertUpstreamUrlAllowed(url, 'public-only'),
        (e: unknown) =>
          e instanceof UpstreamUrlBlockedError &&
          e.code === 'upstream_url_private_forbidden',
      )
    }
  })

  it('rejects decimal IP hostnames in public-only', () => {
    assert.throws(
      () => assertUpstreamUrlAllowed('http://2130706433/v1', 'public-only'),
      (e: unknown) =>
        e instanceof UpstreamUrlBlockedError &&
        e.code === 'upstream_url_private_forbidden',
    )
  })

  it('rejects non-http(s) schemes in public-only', () => {
    assert.throws(
      () => assertUpstreamUrlAllowed('file:///etc/passwd', 'public-only'),
      (e: unknown) =>
        e instanceof UpstreamUrlBlockedError &&
        e.code === 'upstream_url_scheme_forbidden',
    )
  })

  it('rejects invalid URLs in public-only', () => {
    assert.throws(
      () => assertUpstreamUrlAllowed('not-a-url', 'public-only'),
      (e: unknown) =>
        e instanceof UpstreamUrlBlockedError && e.code === 'upstream_url_invalid',
    )
  })
})

describe('assertUpstreamBaseUrlAllowed', () => {
  it('delegates to assertUpstreamUrlAllowed', () => {
    assert.throws(
      () => assertUpstreamBaseUrlAllowed('http://127.0.0.1', 'public-only'),
      UpstreamUrlBlockedError,
    )
  })
})
