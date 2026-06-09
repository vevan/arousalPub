import {
  isPrivateOrLoopbackIpv4,
  parseIpv4ForGuard,
} from './client-ip.js'
import type { UpstreamUrlPolicy } from './config.js'

export class UpstreamUrlBlockedError extends Error {
  constructor(public readonly code: string) {
    super(code)
  }
}

function isDecimalIpHostname(hostname: string): boolean {
  const h = hostname.trim()
  return h.length > 0 && /^\d+$/.test(h)
}

function isBlockedHostname(hostname: string): boolean {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (h === 'localhost' || h === '0.0.0.0') return true
  if (h === '::1' || h === '[::1]') return true
  if (h.endsWith('.localhost')) return true

  if (isDecimalIpHostname(h)) return true

  const v4 = parseIpv4ForGuard(h)
  if (v4 && isPrivateOrLoopbackIpv4(v4)) return true

  if (h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) {
    return true
  }

  return false
}

/** public-only 策略下校验出站 URL（含重定向目标，DOC/25 §8） */
export function assertUpstreamUrlAllowed(
  url: string,
  policy: UpstreamUrlPolicy,
): void {
  if (policy !== 'public-only') return

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new UpstreamUrlBlockedError('upstream_url_invalid')
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UpstreamUrlBlockedError('upstream_url_scheme_forbidden')
  }

  if (isBlockedHostname(parsed.hostname)) {
    throw new UpstreamUrlBlockedError('upstream_url_private_forbidden')
  }
}

/** public-only 策略下校验出站 baseUrl（DOC/25 §8） */
export function assertUpstreamBaseUrlAllowed(
  baseUrl: string,
  policy: UpstreamUrlPolicy,
): void {
  assertUpstreamUrlAllowed(baseUrl, policy)
}
