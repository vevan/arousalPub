import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { stripJsonComments } from './config-jsonc.js'
import { getCurrentUserId } from './user-context.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function findRepoRoot(): string {
  let cur = __dirname
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(cur, 'config.example.json'))) return cur
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return path.resolve(__dirname, '..', '..')
}

const REPO_ROOT = findRepoRoot()

const CONFIG_PATH = path.join(REPO_ROOT, 'config.json')
const CONFIG_EXAMPLE_PATH = path.join(REPO_ROOT, 'config.example.json')

export type UpstreamUrlPolicy = 'open' | 'public-only'

/** 提示词宏展开引擎：`legacy`=Handlebars 管线；`cst`=Lexer/Parser/Walker（开发中） */
export type MacroEngineId = 'legacy' | 'cst'

interface RawConfig {
  dataDir?: string
  serverPort?: number | string
  host?: string
  staticDir?: string
  clientWhitelist?: string[]
  allowPublicRegister?: boolean
  corsOrigins?: string[]
  upstreamUrlPolicy?: string
  macroEngine?: string
  backupEnabled?: boolean
  backupIntervalDays?: number | string
  backupMaxKept?: number | string
  backupRetryHours?: number | string
}

/** 避开 Windows 常见保留段 3326–3425（Hyper-V 等） */
export const DEFAULT_SERVER_PORT = 3450

function parseServerPort(value: unknown, source: string): number {
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`无效的 ${source}：${value}（须为 1–65535 的整数）`)
  }
  return n
}

/** 监听端口：环境变量 PORT / SERVER_PORT > config.json serverPort > 默认 */
export function resolveServerPort(): number {
  const fromEnv = process.env.PORT?.trim() || process.env.SERVER_PORT?.trim()
  if (fromEnv) return parseServerPort(fromEnv, 'PORT/SERVER_PORT')
  const cfg = readConfigFile()
  if (cfg.serverPort != null) {
    return parseServerPort(cfg.serverPort, 'config.json serverPort')
  }
  return DEFAULT_SERVER_PORT
}

/** 监听地址：环境变量 HOST > config.json host > 0.0.0.0 */
export function resolveListenHost(): string {
  const fromEnv = process.env.HOST?.trim()
  if (fromEnv) return fromEnv
  const cfg = readConfigFile()
  const fromCfg = typeof cfg.host === 'string' ? cfg.host.trim() : ''
  if (fromCfg) return fromCfg
  return '0.0.0.0'
}

function ensureConfigFileFromExample(): void {
  if (existsSync(CONFIG_PATH)) return
  if (!existsSync(CONFIG_EXAMPLE_PATH)) return
  try {
    copyFileSync(CONFIG_EXAMPLE_PATH, CONFIG_PATH)
    // eslint-disable-next-line no-console
    console.log(
      `[config] created ${CONFIG_PATH} from config.example.json`,
    )
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[config] failed to copy example config:', e)
  }
}

function parseStringListFromEnv(name: string): string[] | undefined {
  const raw = process.env[name]?.trim()
  if (!raw) return undefined
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
}

function parseBoolFromEnv(name: string): boolean | undefined {
  const raw = process.env[name]?.trim().toLowerCase()
  if (raw === '1' || raw === 'true' || raw === 'yes') return true
  if (raw === '0' || raw === 'false' || raw === 'no') return false
  return undefined
}

/** 客户端 IP 白名单；空数组=不限制（DOC/25 §3） */
export function resolveClientWhitelist(): string[] {
  const fromEnv = parseStringListFromEnv('CLIENT_WHITELIST')
  if (fromEnv) return fromEnv
  const cfg = readConfigFile()
  if (Array.isArray(cfg.clientWhitelist)) {
    return cfg.clientWhitelist
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

export function resolveAllowPublicRegister(): boolean {
  const fromEnv = parseBoolFromEnv('ALLOW_PUBLIC_REGISTER')
  if (fromEnv !== undefined) return fromEnv
  const cfg = readConfigFile()
  if (typeof cfg.allowPublicRegister === 'boolean') {
    return cfg.allowPublicRegister
  }
  return true
}

/** 浏览器 CORS Origin 白名单；空=仅无 Origin 请求（DOC/25 §7） */
export function resolveCorsOrigins(): string[] {
  const fromEnv = parseStringListFromEnv('CORS_ORIGINS')
  if (fromEnv) return fromEnv
  const cfg = readConfigFile()
  if (Array.isArray(cfg.corsOrigins)) {
    return cfg.corsOrigins
      .filter((x): x is string => typeof x === 'string')
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

export function resolveUpstreamUrlPolicy(): UpstreamUrlPolicy {
  const fromEnv = process.env.UPSTREAM_URL_POLICY?.trim().toLowerCase()
  if (fromEnv === 'public-only' || fromEnv === 'open') return fromEnv
  const cfg = readConfigFile()
  const p = typeof cfg.upstreamUrlPolicy === 'string'
    ? cfg.upstreamUrlPolicy.trim().toLowerCase()
    : ''
  if (p === 'public-only') return 'public-only'
  return 'open'
}

function parseMacroEngineId(raw: string | undefined): MacroEngineId | undefined {
  const v = raw?.trim().toLowerCase()
  if (v === 'cst' || v === 'legacy') return v
  return undefined
}

/** 宏引擎：环境变量 MACRO_ENGINE > config.json macroEngine > legacy */
export function resolveMacroEngine(): MacroEngineId {
  const fromEnv = parseMacroEngineId(process.env.MACRO_ENGINE)
  if (fromEnv) return fromEnv
  const cfg = readConfigFile()
  const fromCfg = parseMacroEngineId(
    typeof cfg.macroEngine === 'string' ? cfg.macroEngine : undefined,
  )
  if (fromCfg) return fromCfg
  return 'legacy'
}

export function readConfigFile(): RawConfig {
  ensureConfigFileFromExample()
  if (!existsSync(CONFIG_PATH)) return {}
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(stripJsonComments(raw)) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as RawConfig
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[config] failed to parse config.json, using defaults:', e)
    return {}
  }
}

function resolveDataDir(): string {
  const fromEnv = process.env.DATA_DIR?.trim()
  if (fromEnv) {
    return path.isAbsolute(fromEnv) ? fromEnv : path.resolve(process.cwd(), fromEnv)
  }
  const cfg = readConfigFile()
  const fromCfg = typeof cfg.dataDir === 'string' ? cfg.dataDir.trim() : ''
  if (fromCfg) {
    return path.isAbsolute(fromCfg) ? fromCfg : path.resolve(REPO_ROOT, fromCfg)
  }
  return path.join(REPO_ROOT, 'data')
}

/** 数据根目录：`data/` */
export const DATA_DIR = resolveDataDir()

/** 前端构建目录 `web/dist`（存在 index.html 时返回路径） */
export function resolveWebDistDir(): string | null {
  const fromEnv = process.env.STATIC_DIR?.trim()
  if (fromEnv) {
    const dir = path.isAbsolute(fromEnv)
      ? fromEnv
      : path.resolve(REPO_ROOT, fromEnv)
    return existsSync(path.join(dir, 'index.html')) ? dir : null
  }
  const cfg = readConfigFile()
  const fromCfg = typeof cfg.staticDir === 'string' ? cfg.staticDir.trim() : ''
  if (fromCfg) {
    const dir = path.isAbsolute(fromCfg)
      ? fromCfg
      : path.resolve(REPO_ROOT, fromCfg)
    return existsSync(path.join(dir, 'index.html')) ? dir : null
  }
  const dir = path.join(REPO_ROOT, 'web', 'dist')
  return existsSync(path.join(dir, 'index.html')) ? dir : null
}

/** 用户数据目录：`data/{userId}/` */
export function getUserDataDir(userId: string): string {
  return path.join(DATA_DIR, userId)
}

export function getUsersIndexPath(): string {
  return path.join(DATA_DIR, 'users.index.json')
}

export function getUserAvatarPath(userId: string): string {
  return path.join(getUserDataDir(userId), 'avatar.png')
}

export function getApiSettingsPath(userId?: string): string {
  return path.join(getUserDataDir(userId ?? getCurrentUserId()), 'api-settings.json')
}

export function getApiKeysPath(userId?: string): string {
  return path.join(getUserDataDir(userId ?? getCurrentUserId()), 'api-keys.json')
}

export function getChatsRoot(userId?: string): string {
  return path.join(getUserDataDir(userId ?? getCurrentUserId()), 'chats')
}

export function getLorebooksDir(userId?: string): string {
  return path.join(getUserDataDir(userId ?? getCurrentUserId()), 'lorebooks')
}

export function getCharactersDir(userId?: string): string {
  return path.join(getUserDataDir(userId ?? getCurrentUserId()), 'characters')
}

export function getPromptsDir(userId?: string): string {
  return path.join(getUserDataDir(userId ?? getCurrentUserId()), 'prompts')
}

export function getPromptsIndexPath(userId?: string): string {
  return path.join(getPromptsDir(userId), 'index.json')
}

export function getRegexRulesPath(userId?: string): string {
  return path.join(getUserDataDir(userId ?? getCurrentUserId()), 'regex-rules.json')
}

export function getLorebooksIndexPath(userId?: string): string {
  return path.join(getLorebooksDir(userId), 'index.json')
}

/** @deprecated 请使用 {@link getChatsRoot} */
export const CHAT_ROOT = getChatsRoot

export function ensureDataSkeletonForUser(userId: string): void {
  const userDir = getUserDataDir(userId)
  for (const d of [
    DATA_DIR,
    userDir,
    getChatsRoot(userId),
    getLorebooksDir(userId),
    getCharactersDir(userId),
    getPromptsDir(userId),
  ]) {
    try {
      mkdirSync(d, { recursive: true })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[config] failed to create ${d}:`, e)
    }
  }
}

/** @deprecated 使用 {@link ensureDataSkeletonForUser}；须在已 enterRequestUser 后调用 */
export function ensureDataSkeleton(): void {
  ensureDataSkeletonForUser(getCurrentUserId())
}

// eslint-disable-next-line no-console
console.log(`[config] DATA_DIR = ${DATA_DIR}`)
