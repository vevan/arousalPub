import { readFile } from 'node:fs/promises'
import { getInstalledPluginManifestPath } from './paths.js'
import { normalizeSettingsSchema } from './settings-schema.js'
import type { PluginManifest } from './types.js'

export async function readPluginManifest(
  pluginId: string,
): Promise<PluginManifest | null> {
  const id = pluginId.trim()
  if (!id) return null
  try {
    const raw = await readFile(getInstalledPluginManifestPath(id), 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const m = parsed as Partial<PluginManifest>
    if (typeof m.id !== 'string' || !m.id.trim()) return null
    if (typeof m.name !== 'string' || !m.name.trim()) return null
    if (typeof m.version !== 'string' || !m.version.trim()) return null
    const settingsSchema = normalizeSettingsSchema(m.settingsSchema)
    const conversationSettingsSchema = normalizeSettingsSchema(
      m.conversationSettingsSchema,
    )
    return {
      id: m.id.trim(),
      name: m.name.trim(),
      version: m.version.trim(),
      permissions: Array.isArray(m.permissions)
        ? m.permissions.filter((x): x is string => typeof x === 'string')
        : undefined,
      hooks: Array.isArray(m.hooks)
        ? m.hooks.filter((x): x is string => typeof x === 'string')
        : undefined,
      memory:
        m.memory && typeof m.memory === 'object'
          ? {
              stripBlockTags: Array.isArray(
                (m.memory as { stripBlockTags?: unknown }).stripBlockTags,
              )
                ? (
                    m.memory as { stripBlockTags: unknown[] }
                  ).stripBlockTags.filter(
                    (x): x is string => typeof x === 'string' && x.trim().length > 0,
                  )
                : undefined,
            }
          : undefined,
      ui: m.ui,
      connection: m.connection,
      settingsSchema: settingsSchema ?? undefined,
      conversationSettingsSchema: conversationSettingsSchema ?? undefined,
    }
  } catch {
    return null
  }
}
