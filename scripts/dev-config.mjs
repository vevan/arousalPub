import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '..')

/** 避开 Windows 常见保留段 3326–3425（Hyper-V 等） */
export const DEFAULT_SERVER_PORT = 3450
export const DEFAULT_WEB_PORT = 3451

function parsePort(value, label) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`无效的 ${label}：${value}（须为 1–65535 的整数）`)
  }
  return n
}

function parseNonNegativeInt(value, label, fallback) {
  const n = Number(value)
  if (!Number.isInteger(n) || n < 0) {
    if (value == null || value === '') return fallback
    throw new Error(`无效的 ${label}：${value}（须为 ≥0 的整数）`)
  }
  return n
}

function readConfigFile() {
  const configPath = path.join(REPO_ROOT, 'config.json')
  if (!existsSync(configPath)) return {}
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * 应用配置：环境变量 > config.json > 默认值
 * - 端口：PORT/SERVER_PORT、WEB_PORT
 * - 启动：startCountdownSeconds（START_COUNTDOWN_SEC 可覆盖）
 */
export function loadDevConfig() {
  const cfg = readConfigFile()

  const serverFromEnv = process.env.PORT?.trim() || process.env.SERVER_PORT?.trim()
  const webFromEnv = process.env.WEB_PORT?.trim()
  const countdownFromEnv = process.env.START_COUNTDOWN_SEC?.trim()

  const serverPort = serverFromEnv
    ? parsePort(serverFromEnv, 'PORT/SERVER_PORT')
    : cfg.serverPort != null
      ? parsePort(cfg.serverPort, 'config.json serverPort')
      : DEFAULT_SERVER_PORT

  const webPort = webFromEnv
    ? parsePort(webFromEnv, 'WEB_PORT')
    : cfg.webPort != null
      ? parsePort(cfg.webPort, 'config.json webPort')
      : DEFAULT_WEB_PORT

  const startCountdownSeconds = countdownFromEnv
    ? parseNonNegativeInt(
        countdownFromEnv,
        'START_COUNTDOWN_SEC',
        5,
      )
    : cfg.startCountdownSeconds != null
      ? parseNonNegativeInt(
          cfg.startCountdownSeconds,
          'config.json startCountdownSeconds',
          5,
        )
      : 5

  return { serverPort, webPort, startCountdownSeconds, repoRoot: REPO_ROOT }
}
