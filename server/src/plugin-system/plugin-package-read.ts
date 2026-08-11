import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { getInstalledPluginDir } from './paths.js'
import { assertValidPluginId } from './plugin-id.js'

export async function readPluginPackageFile(
  pluginId: string,
  relPath: string,
): Promise<{ body: Buffer } | null> {
  let id: string
  try {
    id = assertValidPluginId(pluginId)
  } catch {
    return null
  }
  const clean = relPath.replace(/^\/+/, '').replace(/\.\./g, '')
  if (!clean.startsWith('bundles/')) return null
  const root = getInstalledPluginDir(id)
  const full = path.join(root, clean)
  if (!full.startsWith(root)) return null
  try {
    const body = await readFile(full)
    return { body }
  } catch {
    return null
  }
}
