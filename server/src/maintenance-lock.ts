const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

const EXEMPT_PREFIXES = ['/api/admin/', '/api/auth/']

let lockActive = false
let lockReason = ''

export function acquireMaintenanceLock(reason: string): void {
  lockActive = true
  lockReason = reason.trim() || 'maintenance'
}

export function releaseMaintenanceLock(): void {
  lockActive = false
  lockReason = ''
}

export function isMaintenanceLockActive(): boolean {
  return lockActive
}

export function getMaintenanceLockReason(): string {
  return lockReason
}

function isExemptApiPath(pathOnly: string): boolean {
  return EXEMPT_PREFIXES.some((p) => pathOnly.startsWith(p))
}

/** 维护模式下是否应拒绝该写请求 */
export function shouldBlockWriteForMaintenance(
  method: string,
  url: string,
): boolean {
  if (!lockActive) return false
  if (!WRITE_METHODS.has(method.toUpperCase())) return false
  const pathOnly = url.split('?')[0] ?? url
  if (!pathOnly.startsWith('/api/')) return false
  if (isExemptApiPath(pathOnly)) return false
  return true
}
