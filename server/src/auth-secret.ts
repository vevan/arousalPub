import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { DATA_DIR } from './config.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const DEV_FALLBACK = 'arousal-pub-dev-secret-change-in-production'
const SECRET_FILE = path.join(DATA_DIR, '.jwt-secret')

interface ConfigSlice {
  jwtSecret?: string
}

let cachedConfigSlice: ConfigSlice | null = null

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

function readConfigSlice(): ConfigSlice {
  if (cachedConfigSlice) return cachedConfigSlice
  const p = path.join(findRepoRoot(), 'config.json')
  if (!existsSync(p)) {
    cachedConfigSlice = {}
    return cachedConfigSlice
  }
  try {
    cachedConfigSlice = (JSON.parse(readFileSync(p, 'utf8')) as ConfigSlice) ?? {}
    return cachedConfigSlice
  } catch {
    cachedConfigSlice = {}
    return cachedConfigSlice
  }
}

function readPersistedSecret(): string | null {
  if (!existsSync(SECRET_FILE)) return null
  const s = readFileSync(SECRET_FILE, 'utf8').trim()
  return s.length >= 16 ? s : null
}

function persistGeneratedSecret(secret: string): void {
  writeFileSync(SECRET_FILE, `${secret}\n`, { mode: 0o600 })
}

/**
 * JWT 密钥：JWT_SECRET 环境变量 > config.json jwtSecret > data/.jwt-secret（生产可自动生成）
 */
export function resolveJwtSecret(): string {
  const fromEnv = process.env.JWT_SECRET?.trim()
  if (fromEnv) return fromEnv

  const fromCfg = readConfigSlice().jwtSecret
  if (typeof fromCfg === 'string' && fromCfg.trim().length >= 16) {
    return fromCfg.trim()
  }

  const persisted = readPersistedSecret()
  if (persisted) return persisted

  if (process.env.NODE_ENV === 'production') {
    const secret = randomBytes(32).toString('hex')
    persistGeneratedSecret(secret)
    // eslint-disable-next-line no-console
    console.log(
      `[auth] 已在 ${SECRET_FILE} 生成 JWT 密钥（可在 config.json 设置 jwtSecret 覆盖）`,
    )
    return secret
  }

  return DEV_FALLBACK
}
