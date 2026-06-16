export const LIVE_STATE_TURN_COUNT_MIN = 0
export const LIVE_STATE_TURN_COUNT_MAX = 8
export const LIVE_STATE_TURN_COUNT_DEFAULT = 1

export function normalizeLiveStateTurnCount(raw: unknown): number {
  if (typeof raw === 'string' && raw.trim() === '') {
    return LIVE_STATE_TURN_COUNT_DEFAULT
  }
  const n =
    typeof raw === 'number' && Number.isFinite(raw)
      ? Math.floor(raw)
      : typeof raw === 'string'
        ? Number.parseInt(raw, 10)
        : LIVE_STATE_TURN_COUNT_DEFAULT
  if (!Number.isFinite(n)) return LIVE_STATE_TURN_COUNT_DEFAULT
  return Math.max(
    LIVE_STATE_TURN_COUNT_MIN,
    Math.min(LIVE_STATE_TURN_COUNT_MAX, n),
  )
}

/** 会话覆盖优先，否则用户设置，否则默认 */
export function resolveLiveStateTurnCount(
  userSettings?: Record<string, unknown> | null,
  convSettings?: Record<string, unknown> | null,
): number {
  const conv = convSettings ?? {}
  if (Object.prototype.hasOwnProperty.call(conv, 'liveStateTurnCount')) {
    const raw = conv.liveStateTurnCount
    if (raw !== null && raw !== undefined && raw !== '') {
      return normalizeLiveStateTurnCount(raw)
    }
  }
  return normalizeLiveStateTurnCount(userSettings?.liveStateTurnCount)
}
