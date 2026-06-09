import { readConfigFile } from './config.js'

export interface BackupSettings {
  enabled: boolean
  intervalDays: number
  maxKept: number
  retryHours: number
}

const DEFAULT_INTERVAL_DAYS = 7
const DEFAULT_MAX_KEPT = 5
const DEFAULT_RETRY_HOURS = 24

function parsePositiveInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

export function resolveBackupSettings(): BackupSettings {
  const cfg = readConfigFile()
  const enabled = cfg.backupEnabled !== false
  return {
    enabled,
    intervalDays: parsePositiveInt(
      cfg.backupIntervalDays,
      DEFAULT_INTERVAL_DAYS,
      1,
      365,
    ),
    maxKept: parsePositiveInt(cfg.backupMaxKept, DEFAULT_MAX_KEPT, 1, 100),
    retryHours: parsePositiveInt(
      cfg.backupRetryHours,
      DEFAULT_RETRY_HOURS,
      1,
      168,
    ),
  }
}
