export type AuthRateLimitRoute =
  | 'setup'
  | 'register'
  | 'login'
  | 'refresh'
  | 'api_key_reveal'

const LIMITS: Record<
  AuthRateLimitRoute,
  { max: number; windowMs: number }
> = {
  setup: { max: 10, windowMs: 15 * 60 * 1000 },
  register: { max: 10, windowMs: 15 * 60 * 1000 },
  login: { max: 30, windowMs: 15 * 60 * 1000 },
  refresh: { max: 60, windowMs: 15 * 60 * 1000 },
  api_key_reveal: { max: 10, windowMs: 15 * 60 * 1000 },
}

interface Bucket {
  count: number
  windowStart: number
}

const buckets = new Map<string, Bucket>()

function bucketKey(route: AuthRateLimitRoute, ip: string): string {
  return `${route}\0${ip}`
}

/** 通过返回 true；超限返回 false */
export function tryAcquireAuthRateLimitSlot(
  route: AuthRateLimitRoute,
  ip: string | undefined,
): boolean {
  const addr = ip?.trim() || 'unknown'
  const { max, windowMs } = LIMITS[route]
  const key = bucketKey(route, addr)
  const now = Date.now()
  let b = buckets.get(key)
  if (!b || now - b.windowStart >= windowMs) {
    b = { count: 0, windowStart: now }
    buckets.set(key, b)
  }
  if (b.count >= max) return false
  b.count += 1
  return true
}
