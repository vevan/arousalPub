import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertValidPluginId } from './plugin-id.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function findRepoRoot(): string {
  let cur = __dirname
  for (let i = 0; i < 8; i++) {
    if (existsSync(path.join(cur, 'config.example.yaml'))) return cur
    const parent = path.dirname(cur)
    if (parent === cur) break
    cur = parent
  }
  return path.resolve(__dirname, '..', '..', '..')
}

const REPO_ROOT = findRepoRoot()

export type BundledPluginCatalogEntry = {
  id: string
  order: number
  /** 相对 `plugins/` 的目录名 */
  path: string
}

export type BundledPluginCatalog = {
  version: 1
  plugins: BundledPluginCatalogEntry[]
}

let cachedCatalog: BundledPluginCatalog | null = null

function normalizeEntry(raw: unknown): BundledPluginCatalogEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const rawId = typeof o.id === 'string' ? o.id.trim() : ''
  if (!rawId) return null
  let id: string
  try {
    id = assertValidPluginId(rawId)
  } catch {
    return null
  }
  const order =
    typeof o.order === 'number' && Number.isFinite(o.order)
      ? Math.round(o.order)
      : 100
  const relPath =
    typeof o.path === 'string' && o.path.trim()
      ? o.path.trim()
      : id
  return { id, order, path: relPath }
}

export function getBundledRegistryPath(): string {
  return path.join(REPO_ROOT, 'plugins', 'bundled-registry.json')
}

export async function readBundledPluginCatalog(): Promise<BundledPluginCatalog> {
  if (cachedCatalog) return cachedCatalog
  const p = getBundledRegistryPath()
  const raw = await readFile(p, 'utf8')
  const parsed = JSON.parse(raw) as unknown
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('invalid_bundled_registry')
  }
  const doc = parsed as Partial<BundledPluginCatalog>
  const plugins: BundledPluginCatalogEntry[] = []
  if (Array.isArray(doc.plugins)) {
    for (const item of doc.plugins) {
      const e = normalizeEntry(item)
      if (e) plugins.push(e)
    }
  }
  if (plugins.length === 0) {
    throw new Error('empty_bundled_registry')
  }
  plugins.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  cachedCatalog = { version: 1, plugins }
  return cachedCatalog
}

/** 测试或强制重读 catalog 后调用 */
export function invalidateBundledPluginCatalogCache(): void {
  cachedCatalog = null
}

export function getBundledPluginSourceDirForEntry(
  entry: BundledPluginCatalogEntry,
): string {
  return path.join(REPO_ROOT, 'plugins', entry.path)
}
