import { copyFileSync, existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse as parseYaml } from 'yaml'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = path.resolve(__dirname, '..')

const CONFIG_EXAMPLE = 'config.example.yaml'
const CONFIG_FILE = 'config.yaml'

export function findRepoRoot() {
  let cur = REPO_ROOT
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(cur, CONFIG_EXAMPLE))) return cur
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return REPO_ROOT
}

export function getConfigPaths(root = findRepoRoot()) {
  return {
    config: path.join(root, CONFIG_FILE),
    example: path.join(root, CONFIG_EXAMPLE),
  }
}

export function ensureConfigFileFromExample(root = findRepoRoot()) {
  const { config, example } = getConfigPaths(root)
  if (existsSync(config)) return
  if (!existsSync(example)) return
  try {
    copyFileSync(example, config)
    // eslint-disable-next-line no-console
    console.log(`[config] created ${config} from ${CONFIG_EXAMPLE}`)
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[config] failed to copy example config:', e)
  }
}

/** @returns {Record<string, unknown>} */
export function readConfigFile(root = findRepoRoot()) {
  ensureConfigFileFromExample(root)
  const { config } = getConfigPaths(root)
  if (!existsSync(config)) return {}
  try {
    const parsed = parseYaml(readFileSync(config, 'utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    return parsed
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn('[config] failed to parse config.yaml, using defaults:', e)
    return {}
  }
}
