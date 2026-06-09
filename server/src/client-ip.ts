/** 请求是否来自本机 loopback（见 DOC/17 §2.1、DOC/25 §4.1） */
export function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false
  const n = ip.toLowerCase()
  if (n === '127.0.0.1' || n === '::1') return true
  if (n.startsWith('::ffff:')) {
    const v4 = n.slice('::ffff:'.length)
    if (v4 === '127.0.0.1') return true
  }
  return false
}

const LOOPBACK_ALWAYS_ALLOWED = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
])

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  const out: number[] = []
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n < 0 || n > 255) return null
    out.push(n)
  }
  return out
}

/** SillyTavern 风格：`192.168.0.*`、`100.*.*.*`；也支持精确 IP */
export function matchIpWhitelistPattern(
  ip: string,
  pattern: string,
): boolean {
  const pat = pattern.trim().toLowerCase()
  const addr = ip.toLowerCase()
  if (!pat || !addr) return false
  if (!pat.includes('*')) return pat === addr

  if (addr.includes(':')) {
    return false
  }

  const patParts = pat.split('.')
  const ipParts = addr.split('.')
  if (patParts.length !== ipParts.length) return false

  for (let i = 0; i < patParts.length; i++) {
    const pp = patParts[i]!
    const ipp = ipParts[i]!
    if (pp === '*') continue
    if (pp !== ipp) return false
  }
  return true
}

export function isClientIpAllowed(
  ip: string | undefined,
  whitelist: string[],
): boolean {
  if (!whitelist.length) return true
  if (!ip) return false
  const n = ip.toLowerCase()
  if (LOOPBACK_ALWAYS_ALLOWED.has(n)) return true

  for (const pattern of whitelist) {
    if (matchIpWhitelistPattern(n, pattern)) return true
  }
  return false
}

/** 供 SSRF 判断：IPv4 是否私有/链路本地 */
export function isPrivateOrLoopbackIpv4(octets: number[]): boolean {
  if (octets.length !== 4) return false
  const [a, b] = octets
  if (a === 127) return true
  if (a === 10) return true
  if (a === 172 && b >= 16 && b <= 31) return true
  if (a === 192 && b === 168) return true
  if (a === 169 && b === 254) return true
  if (a === 100 && b >= 64 && b <= 127) return true
  return false
}

export function parseIpv4ForGuard(host: string): number[] | null {
  return ipv4Octets(host)
}
