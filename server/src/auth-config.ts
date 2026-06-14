import { readConfigFile } from './config.js'

const DEFAULT_IDLE_MINUTES = 15
const DEFAULT_REFRESH_DAYS = 7
const DEFAULT_ACCESS_MINUTES = 30

function positiveInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim())
  if (!Number.isFinite(n) || n <= 0) return fallback
  return Math.floor(n)
}

export function getAuthIdleMs(): number {
  const cfg = readConfigFile()
  const m = positiveInt(cfg.authIdleMinutes, DEFAULT_IDLE_MINUTES)
  return m * 60 * 1000
}

export function getAuthDefaultRefreshMs(): number {
  const cfg = readConfigFile()
  const d = positiveInt(cfg.authDefaultRefreshDays, DEFAULT_REFRESH_DAYS)
  return d * 24 * 60 * 60 * 1000
}

export function getAuthAccessTtlSeconds(): number {
  const cfg = readConfigFile()
  const m = positiveInt(cfg.authAccessMinutes, DEFAULT_ACCESS_MINUTES)
  return m * 60
}
