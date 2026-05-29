import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
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

interface RawConfig {
  dataDir?: string
  serverPort?: number | string
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

function readConfigFile(): RawConfig {
  ensureConfigFileFromExample()
  if (!existsSync(CONFIG_PATH)) return {}
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf8')
    const parsed = JSON.parse(raw) as unknown
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

/** 当前用户数据目录：`data/{userId}/`，未选用户时为 `default-user` */
export function getUserDataDir(userId?: string): string {
  return path.join(DATA_DIR, userId ?? getCurrentUserId())
}

export function getApiSettingsPath(): string {
  return path.join(getUserDataDir(), 'api-settings.json')
}

export function getApiKeysPath(): string {
  return path.join(getUserDataDir(), 'api-keys.json')
}

export function getChatsRoot(): string {
  return path.join(getUserDataDir(), 'chats')
}

export function getLorebooksDir(): string {
  return path.join(getUserDataDir(), 'lorebooks')
}

export function getCharactersDir(): string {
  return path.join(getUserDataDir(), 'characters')
}

export function getPromptsDir(): string {
  return path.join(getUserDataDir(), 'prompts')
}

export function getPromptsIndexPath(): string {
  return path.join(getPromptsDir(), 'index.json')
}

export function getLorebooksIndexPath(): string {
  return path.join(getLorebooksDir(), 'index.json')
}

/** @deprecated 请使用 {@link getChatsRoot} */
export const CHAT_ROOT = getChatsRoot

export function ensureDataSkeleton(): void {
  const userDir = getUserDataDir()
  for (const d of [
    DATA_DIR,
    userDir,
    getChatsRoot(),
    getLorebooksDir(),
    getCharactersDir(),
    getPromptsDir(),
  ]) {
    try {
      mkdirSync(d, { recursive: true })
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn(`[config] failed to create ${d}:`, e)
    }
  }
}

// eslint-disable-next-line no-console
console.log(`[config] DATA_DIR = ${DATA_DIR}`)
