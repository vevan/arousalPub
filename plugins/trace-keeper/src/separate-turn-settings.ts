export const SEPARATE_TURN_COUNT_MIN = 1
export const SEPARATE_TURN_COUNT_MAX = 8
export const SEPARATE_TURN_COUNT_DEFAULT = 4

export function normalizeSeparateTurnCount(raw: unknown): number {
  if (typeof raw === 'string' && raw.trim() === '') {
    return SEPARATE_TURN_COUNT_DEFAULT
  }
  const n =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.floor(raw)
      : typeof raw === 'string'
        ? Number.parseInt(raw, 10)
        : SEPARATE_TURN_COUNT_DEFAULT
  if (!Number.isFinite(n)) return SEPARATE_TURN_COUNT_DEFAULT
  return Math.max(
    SEPARATE_TURN_COUNT_MIN,
    Math.min(SEPARATE_TURN_COUNT_MAX, n),
  )
}

/** 会话 separateTurnCount 覆盖；否则用户设置；默认 4。 */
export function resolveSeparateTurnCount(
  userSettings?: Record<string, unknown> | null,
  convSettings?: Record<string, unknown> | null,
): number {
  const conv = convSettings ?? {}
  if (Object.prototype.hasOwnProperty.call(conv, 'separateTurnCount')) {
    const raw = conv.separateTurnCount
    if (raw !== null && raw !== undefined && raw !== '') {
      return normalizeSeparateTurnCount(raw)
    }
  }
  const user = userSettings ?? {}
  if (Object.prototype.hasOwnProperty.call(user, 'separateTurnCount')) {
    return normalizeSeparateTurnCount(user.separateTurnCount)
  }
  return SEPARATE_TURN_COUNT_DEFAULT
}
