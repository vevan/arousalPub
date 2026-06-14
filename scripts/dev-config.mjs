import path from 'node:path'
import { readConfigFile, REPO_ROOT } from './load-config.mjs'

export { REPO_ROOT }

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

/**
 * 应用配置：环境变量 > config.yaml > 默认值
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
      ? parsePort(cfg.serverPort, 'config.yaml serverPort')
      : DEFAULT_SERVER_PORT

  const webPort = webFromEnv
    ? parsePort(webFromEnv, 'WEB_PORT')
    : cfg.webPort != null
      ? parsePort(cfg.webPort, 'config.yaml webPort')
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
          'config.yaml startCountdownSeconds',
          5,
        )
      : 5

  return { serverPort, webPort, startCountdownSeconds, repoRoot: REPO_ROOT }
}

/** 数据目录：环境变量 DATA_DIR > config.yaml dataDir > 仓库 data/ */
export function resolveDataDir() {
  const fromEnv = process.env.DATA_DIR?.trim()
  if (fromEnv) {
    return path.isAbsolute(fromEnv)
      ? fromEnv
      : path.resolve(process.cwd(), fromEnv)
  }
  const cfg = readConfigFile()
  const fromCfg = typeof cfg.dataDir === 'string' ? cfg.dataDir.trim() : ''
  if (fromCfg) {
    return path.isAbsolute(fromCfg)
      ? fromCfg
      : path.resolve(REPO_ROOT, fromCfg)
  }
  return path.join(REPO_ROOT, 'data')
}
