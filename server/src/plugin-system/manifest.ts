import { readFile } from 'node:fs/promises'
import { getInstalledPluginManifestPath } from './paths.js'
import { normalizeSettingsSchema } from './settings-schema.js'
import type { PluginManifest } from './types.js'

const ACTION_NAME_RE = /^[a-z0-9][a-z0-9-]{0,63}$/

function normalizeServerActions(
  raw: unknown,
): PluginManifest['serverActions'] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const out: NonNullable<PluginManifest['serverActions']> = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const name =
      typeof (item as { name?: unknown }).name === 'string'
        ? (item as { name: string }).name.trim()
        : ''
    if (!name || !ACTION_NAME_RE.test(name)) continue
    const permsRaw = (item as { permissions?: unknown }).permissions
    const permissions = Array.isArray(permsRaw)
      ? permsRaw.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : []
    if (permissions.length === 0) continue
    out.push({ name, permissions })
  }
  return out.length ? out : undefined
}

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
      turnPlugins:
        m.turnPlugins && typeof m.turnPlugins === 'object'
          ? {
              mergeMode:
                (m.turnPlugins as { mergeMode?: unknown }).mergeMode ===
                'receive-scoped'
                  ? 'receive-scoped'
                  : (m.turnPlugins as { mergeMode?: unknown }).mergeMode ===
                      'replace-by-plugin-id'
                    ? 'replace-by-plugin-id'
                    : undefined,
              receiveIdKey:
                typeof (m.turnPlugins as { receiveIdKey?: unknown }).receiveIdKey ===
                'string'
                  ? (m.turnPlugins as { receiveIdKey: string }).receiveIdKey.trim()
                  : undefined,
            }
          : undefined,
      serverActions: normalizeServerActions(
        (m as { serverActions?: unknown }).serverActions,
      ),
      lifecycle:
        m.lifecycle && typeof m.lifecycle === 'object'
          ? {
              onCharacterPrimaryChanged:
                (m.lifecycle as { onCharacterPrimaryChanged?: unknown })
                  .onCharacterPrimaryChanged === true,
            }
          : undefined,
      ui:
        m.ui && typeof m.ui === 'object'
          ? {
              slots: Array.isArray((m.ui as { slots?: unknown }).slots)
                ? (m.ui as { slots: unknown[] }).slots.filter(
                    (s): s is { name: string; entry?: string } =>
                      !!s &&
                      typeof s === 'object' &&
                      typeof (s as { name?: unknown }).name === 'string',
                  )
                : undefined,
              eagerOnRoutes: Array.isArray(
                (m.ui as { eagerOnRoutes?: unknown }).eagerOnRoutes,
              )
                ? (m.ui as { eagerOnRoutes: unknown[] }).eagerOnRoutes
                    .filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
                    .map((x) => x.trim())
                : undefined,
            }
          : undefined,
      connection: m.connection,
      settingsSchema: settingsSchema ?? undefined,
      conversationSettingsSchema: conversationSettingsSchema ?? undefined,
    }
  } catch {
    return null
  }
}
