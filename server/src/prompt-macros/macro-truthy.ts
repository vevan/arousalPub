/** ST 条件真值：空串、false、0、off、no 为假 */

const FALSY_LITERALS = new Set(['', 'false', '0', 'off', 'no'])

export function isStTruthy(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false
  const s = String(raw).trim().toLowerCase()
  return !FALSY_LITERALS.has(s)
}

export function trimScopedBlockContent(body: string): string {
  let s = body
  if (s.startsWith('\r\n')) s = s.slice(2)
  else if (s.startsWith('\n')) s = s.slice(1)
  if (s.endsWith('\r\n')) s = s.slice(0, -2)
  else if (s.endsWith('\n')) s = s.slice(0, -1)
  return s.trimEnd()
}
