export const TOOL_READ_TURN_COUNT_MIN = 1
export const TOOL_READ_TURN_COUNT_MAX = 40
export const TOOL_READ_TURN_COUNT_DEFAULT = 8

export function normalizeToolReadTurnCount(raw: unknown): number {
  if (typeof raw === 'string' && raw.trim() === '') {
    return TOOL_READ_TURN_COUNT_DEFAULT
  }
  const n =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.floor(raw)
      : typeof raw === 'string'
        ? Number.parseInt(raw, 10)
        : TOOL_READ_TURN_COUNT_DEFAULT
  if (!Number.isFinite(n)) return TOOL_READ_TURN_COUNT_DEFAULT
  return Math.max(
    TOOL_READ_TURN_COUNT_MIN,
    Math.min(TOOL_READ_TURN_COUNT_MAX, n),
  )
}

/** 会话 toolReadTurnCount 覆盖；否则用户设置；默认 8。 */
export function resolveToolReadTurnCount(
  userSettings?: Record<string, unknown> | null,
  convSettings?: Record<string, unknown> | null,
): number {
  const conv = convSettings ?? {}
  if (Object.prototype.hasOwnProperty.call(conv, 'toolReadTurnCount')) {
    const raw = conv.toolReadTurnCount
    if (raw !== null && raw !== undefined && raw !== '') {
      return normalizeToolReadTurnCount(raw)
    }
  }
  const user = userSettings ?? {}
  if (Object.prototype.hasOwnProperty.call(user, 'toolReadTurnCount')) {
    return normalizeToolReadTurnCount(user.toolReadTurnCount)
  }
  return TOOL_READ_TURN_COUNT_DEFAULT
}
