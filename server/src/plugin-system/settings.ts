import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { getCurrentUserId } from '../user-context.js'
import { readPluginManifest } from './manifest.js'
import {
  getPluginUserDataDir,
  getPluginUserSettingsPath,
} from './paths.js'
import {
  schemaDefaults,
  validatePluginSettings,
} from './settings-schema.js'
import type { PluginSettingsSchema } from './types.js'

export async function readMergedPluginUserSettings(
  pluginId: string,
  userId?: string,
): Promise<Record<string, unknown>> {
  const uid = userId ?? getCurrentUserId()
  const manifest = await readPluginManifest(pluginId)
  const schema = manifest?.settingsSchema ?? null
  const defaults = schemaDefaults(schema)
  const path = getPluginUserSettingsPath(pluginId, uid)
  if (!existsSync(path)) return defaults
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as unknown
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return defaults
    const merged = { ...defaults, ...(raw as Record<string, unknown>) }
    return validatePluginSettings(schema, merged)
  } catch {
    return defaults
  }
}

export async function writePluginUserSettings(
  pluginId: string,
  raw: unknown,
  userId?: string,
): Promise<Record<string, unknown>> {
  const uid = userId ?? getCurrentUserId()
  const manifest = await readPluginManifest(pluginId)
  if (!manifest) throw new Error('plugin_not_found')
  const schema = manifest.settingsSchema ?? null
  const doc = validatePluginSettings(schema, raw)
  const dir = getPluginUserDataDir(pluginId, uid)
  await mkdir(dir, { recursive: true })
  await writeFile(
    getPluginUserSettingsPath(pluginId, uid),
    `${JSON.stringify(doc, null, 2)}\n`,
    'utf8',
  )
  return doc
}

export function pluginHasSettingsSchema(
  schema: PluginSettingsSchema | null | undefined,
): boolean {
  return Boolean(schema && schema.fields.length > 0)
}
