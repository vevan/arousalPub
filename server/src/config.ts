import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * 仓库根 = 含 config.example.json 的最近祖先目录。
 * 启动时一次性查找；找不到则回退到 server/.. （即旧的 server 包根的上一级，约等于仓库根）。
 */
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

/**
 * 解析 DATA_DIR：
 * 1. 环境变量 DATA_DIR（绝对或相对，相对以 process.cwd() 为基准）
 * 2. config.json#dataDir（相对则以 config.json 所在目录 = REPO_ROOT 为基准）
 * 3. 默认 REPO_ROOT/data
 */
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

export const DATA_DIR = resolveDataDir()
export const API_SETTINGS_PATH = path.join(DATA_DIR, 'api-settings.json')
export const API_KEYS_PATH = path.join(DATA_DIR, 'api-keys.json')
export const PROMPTS_PATH = path.join(DATA_DIR, 'prompts.json')
/** 对话与会话列表根目录：`data/chats/` */
export const CHATS_ROOT = path.join(DATA_DIR, 'chats')
/** 世界书根目录：`data/lorebooks/` */
export const LOREBOOKS_DIR = path.join(DATA_DIR, 'lorebooks')
/** 角色卡库根目录：`data/characters/` */
export const CHARACTERS_DIR = path.join(DATA_DIR, 'characters')

/** @deprecated 请使用 {@link CHATS_ROOT}（路径已为 `chats/`） */
export const CHAT_ROOT = CHATS_ROOT

/** 启动时确保骨架目录存在，避免后续每次写入都 mkdir。 */
export function ensureDataSkeleton(): void {
  for (const d of [DATA_DIR, CHATS_ROOT, LOREBOOKS_DIR, CHARACTERS_DIR]) {
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
