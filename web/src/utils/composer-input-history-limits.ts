export const COMPOSER_INPUT_HISTORY_PINNED_MAX_DEFAULT = 5
export const COMPOSER_INPUT_HISTORY_RECENT_MAX_DEFAULT = 10

export const COMPOSER_INPUT_HISTORY_PINNED_MAX_MIN = 1
export const COMPOSER_INPUT_HISTORY_PINNED_MAX_CAP = 50
export const COMPOSER_INPUT_HISTORY_RECENT_MAX_MIN = 1
export const COMPOSER_INPUT_HISTORY_RECENT_MAX_CAP = 100

export const COMPOSER_INPUT_HISTORY_PINNED_MAX_STORAGE_KEY =
  'arousal-composer-input-history-pinned-max'
export const COMPOSER_INPUT_HISTORY_RECENT_MAX_STORAGE_KEY =
  'arousal-composer-input-history-recent-max'

export interface ComposerInputHistoryLimits {
  pinnedMax: number
  recentMax: number
}

function clampInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number.parseInt(raw, 10)
        : Number.NaN
  if (!Number.isFinite(n)) return fallback
  return Math.min(max, Math.max(min, Math.round(n)))
}

export function normalizeComposerInputHistoryLimits(
  partial?: Partial<ComposerInputHistoryLimits>,
): ComposerInputHistoryLimits {
  return {
    pinnedMax: clampInt(
      partial?.pinnedMax,
      COMPOSER_INPUT_HISTORY_PINNED_MAX_DEFAULT,
      COMPOSER_INPUT_HISTORY_PINNED_MAX_MIN,
      COMPOSER_INPUT_HISTORY_PINNED_MAX_CAP,
    ),
    recentMax: clampInt(
      partial?.recentMax,
      COMPOSER_INPUT_HISTORY_RECENT_MAX_DEFAULT,
      COMPOSER_INPUT_HISTORY_RECENT_MAX_MIN,
      COMPOSER_INPUT_HISTORY_RECENT_MAX_CAP,
    ),
  }
}

export function readComposerInputHistoryLimits(): ComposerInputHistoryLimits {
  try {
    return {
      pinnedMax: clampInt(
        localStorage.getItem(COMPOSER_INPUT_HISTORY_PINNED_MAX_STORAGE_KEY),
        COMPOSER_INPUT_HISTORY_PINNED_MAX_DEFAULT,
        COMPOSER_INPUT_HISTORY_PINNED_MAX_MIN,
        COMPOSER_INPUT_HISTORY_PINNED_MAX_CAP,
      ),
      recentMax: clampInt(
        localStorage.getItem(COMPOSER_INPUT_HISTORY_RECENT_MAX_STORAGE_KEY),
        COMPOSER_INPUT_HISTORY_RECENT_MAX_DEFAULT,
        COMPOSER_INPUT_HISTORY_RECENT_MAX_MIN,
        COMPOSER_INPUT_HISTORY_RECENT_MAX_CAP,
      ),
    }
  } catch {
    return normalizeComposerInputHistoryLimits()
  }
}

export function writeComposerInputHistoryLimits(
  limits: ComposerInputHistoryLimits,
): ComposerInputHistoryLimits {
  const normalized = normalizeComposerInputHistoryLimits(limits)
  try {
    localStorage.setItem(
      COMPOSER_INPUT_HISTORY_PINNED_MAX_STORAGE_KEY,
      String(normalized.pinnedMax),
    )
    localStorage.setItem(
      COMPOSER_INPUT_HISTORY_RECENT_MAX_STORAGE_KEY,
      String(normalized.recentMax),
    )
  } catch {
    /* ignore */
  }
  return normalized
}
