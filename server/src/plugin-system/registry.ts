import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { getUserDataDir } from '../config.js'
import { getCurrentUserId } from '../user-context.js'
import { getPluginRegistryPath } from './paths.js'
import { assertValidPluginId } from './plugin-id.js'
import type { PluginRegistryDocument, PluginRegistryEntry } from './types.js'

const DEFAULT_REGISTRY: PluginRegistryDocument = {
  version: 1,
  plugins: [],
}

function normalizeEntry(raw: unknown): PluginRegistryEntry | null {
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
  const enabled = o.enabled !== false
  const order =
    typeof o.order === 'number' && Number.isFinite(o.order)
      ? Math.round(o.order)
      : 100
  return { id, enabled, order }
}

async function ensureUserRegistryFile(userId: string): Promise<void> {
  const userPath = getPluginRegistryPath(userId)
  if (existsSync(userPath)) return
  await mkdir(getUserDataDir(userId), { recursive: true })
  await writeFile(
    userPath,
    `${JSON.stringify(DEFAULT_REGISTRY, null, 2)}\n`,
    'utf8',
  )
}

export async function readPluginRegistry(
  userId?: string,
): Promise<PluginRegistryDocument> {
  const uid = userId ?? getCurrentUserId()
  await ensureUserRegistryFile(uid)
  const p = getPluginRegistryPath(uid)
  try {
    const raw = await readFile(p, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return DEFAULT_REGISTRY
    const doc = parsed as Partial<PluginRegistryDocument>
    const plugins: PluginRegistryEntry[] = []
    if (Array.isArray(doc.plugins)) {
      for (const item of doc.plugins) {
        const e = normalizeEntry(item)
        if (e) plugins.push(e)
      }
    }
    if (plugins.length === 0) return DEFAULT_REGISTRY
    plugins.sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    return { version: 1, plugins }
  } catch {
    return DEFAULT_REGISTRY
  }
}

export async function writePluginRegistry(
  doc: PluginRegistryDocument,
  userId?: string,
): Promise<void> {
  const uid = userId ?? getCurrentUserId()
  await ensureUserRegistryFile(uid)
  const sorted = {
    version: 1 as const,
    plugins: [...doc.plugins].sort(
      (a, b) => a.order - b.order || a.id.localeCompare(b.id),
    ),
  }
  await writeFile(
    getPluginRegistryPath(uid),
    `${JSON.stringify(sorted, null, 2)}\n`,
    'utf8',
  )
}

export { DEFAULT_REGISTRY }
