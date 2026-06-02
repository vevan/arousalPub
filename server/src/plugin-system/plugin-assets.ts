import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import {
  getInstalledPluginDir,
  getPluginUserAssetsDir,
} from './paths.js'
import { readPluginManifest } from './manifest.js'

const DEFAULT_MAX_BYTES = 5 * 1024 * 1024

const MIME_BY_EXT: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
}

function sanitizeAssetName(name: string): string | null {
  const base = path.basename(name.replace(/\\/g, '/')).trim()
  if (!base || base.includes('..') || /[/\\]/.test(base)) return null
  return base
}

function extAllowed(name: string, accept?: string[]): boolean {
  const ext = path.extname(name).toLowerCase()
  if (!ext) return false
  if (!accept || accept.length === 0) {
    return ext in MIME_BY_EXT
  }
  return accept.some((a) => {
    const norm = a.startsWith('.') ? a.toLowerCase() : `.${a.toLowerCase()}`
    return norm === ext
  })
}

export function assetContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase()
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

export async function readPluginBundledAsset(
  pluginId: string,
  name: string,
  accept?: string[],
): Promise<{ body: Buffer; contentType: string } | null> {
  const id = pluginId.trim()
  const clean = sanitizeAssetName(name)
  if (!id || !clean || !extAllowed(clean, accept)) return null
  const root = path.join(getInstalledPluginDir(id), 'assets')
  const full = path.join(root, clean)
  if (!full.startsWith(root)) return null
  try {
    const body = await readFile(full)
    return { body, contentType: assetContentType(clean) }
  } catch {
    return null
  }
}

export async function readPluginUserAsset(
  pluginId: string,
  name: string,
  userId: string,
  accept?: string[],
): Promise<{ body: Buffer; contentType: string } | null> {
  const id = pluginId.trim()
  const clean = sanitizeAssetName(name)
  if (!id || !clean || !extAllowed(clean, accept)) return null
  const root = getPluginUserAssetsDir(id, userId)
  const full = path.join(root, clean)
  if (!full.startsWith(root)) return null
  try {
    const body = await readFile(full)
    return { body, contentType: assetContentType(clean) }
  } catch {
    return null
  }
}

export async function savePluginUserAssetUpload(params: {
  pluginId: string
  userId: string
  filename: string
  buffer: Buffer
  fieldKey?: string
}): Promise<{ filename: string }> {
  const id = params.pluginId.trim()
  const clean = sanitizeAssetName(params.filename)
  if (!id || !clean) throw new Error('invalid_filename')
  if (params.buffer.length > DEFAULT_MAX_BYTES) throw new Error('file_too_large')

  const manifest = await readPluginManifest(id)
  if (!manifest) throw new Error('plugin_not_found')
  const field = manifest.settingsSchema?.fields.find(
    (f) => f.type === 'fileAsset' && (!params.fieldKey || f.key === params.fieldKey),
  )
  const accept = field?.accept
  if (!extAllowed(clean, accept)) throw new Error('invalid_extension')

  const dir = getPluginUserAssetsDir(id, params.userId)
  await mkdir(dir, { recursive: true })
  const dest = path.join(dir, clean)
  if (!dest.startsWith(dir)) throw new Error('invalid_path')
  await writeFile(dest, params.buffer)
  return { filename: clean }
}

export async function fileAssetExists(
  pluginId: string,
  filename: string,
  userId: string,
): Promise<boolean> {
  const clean = sanitizeAssetName(filename)
  if (!clean) return false
  return existsSync(path.join(getPluginUserAssetsDir(pluginId, userId), clean))
}
