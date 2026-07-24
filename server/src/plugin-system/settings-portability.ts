import { getCurrentUserId } from '../user-context.js'
import { readPluginManifest } from './manifest.js'
import { assertValidPluginId } from './plugin-id.js'
import { readPluginRegistry, writePluginRegistry } from './registry.js'
import {
  readMergedPluginUserSettings,
  writePluginUserSettings,
} from './settings.js'

export const PLUGIN_SETTINGS_EXPORT_FORMAT = 'arousal-plugin-settings-v1' as const

export type PluginSettingsExportEnvelope = {
  format: typeof PLUGIN_SETTINGS_EXPORT_FORMAT
  pluginId: string
  pluginVersion?: string
  exportedAt: string
  enabled: boolean
  settings: Record<string, unknown>
}

export class PluginSettingsPortabilityError extends Error {
  readonly code:
    | 'plugin_settings_import_invalid'
    | 'plugin_settings_plugin_mismatch'
    | 'plugin_not_found'
    | 'invalid_plugin_id'

  constructor(
    code: PluginSettingsPortabilityError['code'],
    message?: string,
  ) {
    super(message ?? code)
    this.name = 'PluginSettingsPortabilityError'
    this.code = code
  }
}

export function parsePluginSettingsImportBody(
  raw: unknown,
  expectedPluginId: string,
): PluginSettingsExportEnvelope {
  let expected: string
  try {
    expected = assertValidPluginId(expectedPluginId)
  } catch {
    throw new PluginSettingsPortabilityError('invalid_plugin_id')
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new PluginSettingsPortabilityError('plugin_settings_import_invalid')
  }
  const o = raw as Record<string, unknown>
  if (o.format !== PLUGIN_SETTINGS_EXPORT_FORMAT) {
    throw new PluginSettingsPortabilityError('plugin_settings_import_invalid')
  }
  const rawId = typeof o.pluginId === 'string' ? o.pluginId.trim() : ''
  let pluginId: string
  try {
    pluginId = assertValidPluginId(rawId)
  } catch {
    throw new PluginSettingsPortabilityError('plugin_settings_import_invalid')
  }
  if (pluginId !== expected) {
    throw new PluginSettingsPortabilityError('plugin_settings_plugin_mismatch')
  }
  if (typeof o.enabled !== 'boolean') {
    throw new PluginSettingsPortabilityError('plugin_settings_import_invalid')
  }
  if (
    !o.settings ||
    typeof o.settings !== 'object' ||
    Array.isArray(o.settings)
  ) {
    throw new PluginSettingsPortabilityError('plugin_settings_import_invalid')
  }
  const envelope: PluginSettingsExportEnvelope = {
    format: PLUGIN_SETTINGS_EXPORT_FORMAT,
    pluginId,
    exportedAt:
      typeof o.exportedAt === 'string' && o.exportedAt.trim()
        ? o.exportedAt.trim()
        : new Date().toISOString(),
    enabled: o.enabled,
    settings: o.settings as Record<string, unknown>,
  }
  if (typeof o.pluginVersion === 'string' && o.pluginVersion.trim()) {
    envelope.pluginVersion = o.pluginVersion.trim()
  }
  return envelope
}

export async function exportPluginUserSettingsPortable(
  pluginId: string,
  userId?: string,
): Promise<PluginSettingsExportEnvelope> {
  let id: string
  try {
    id = assertValidPluginId(pluginId)
  } catch {
    throw new PluginSettingsPortabilityError('invalid_plugin_id')
  }
  const uid = userId ?? getCurrentUserId()
  const manifest = await readPluginManifest(id)
  if (!manifest || manifest.id !== id) {
    throw new PluginSettingsPortabilityError('plugin_not_found')
  }
  const registry = await readPluginRegistry(uid)
  const entry = registry.plugins.find((p) => p.id === id)
  if (!entry) {
    throw new PluginSettingsPortabilityError('plugin_not_found')
  }
  const settings = await readMergedPluginUserSettings(id, uid)
  return {
    format: PLUGIN_SETTINGS_EXPORT_FORMAT,
    pluginId: id,
    pluginVersion: manifest.version,
    exportedAt: new Date().toISOString(),
    enabled: entry.enabled,
    settings,
  }
}

export async function importPluginUserSettingsPortable(
  pluginId: string,
  raw: unknown,
  userId?: string,
): Promise<{ settings: Record<string, unknown>; enabled: boolean }> {
  const envelope = parsePluginSettingsImportBody(raw, pluginId)
  const uid = userId ?? getCurrentUserId()
  const manifest = await readPluginManifest(envelope.pluginId)
  if (!manifest || manifest.id !== envelope.pluginId) {
    throw new PluginSettingsPortabilityError('plugin_not_found')
  }
  const registry = await readPluginRegistry(uid)
  const entry = registry.plugins.find((p) => p.id === envelope.pluginId)
  if (!entry) {
    throw new PluginSettingsPortabilityError('plugin_not_found')
  }
  // 先确认 registry 条目存在，再写 settings，避免 settings 已改而 enabled 未改
  const settings = await writePluginUserSettings(
    envelope.pluginId,
    envelope.settings,
    uid,
  )
  entry.enabled = envelope.enabled
  await writePluginRegistry(registry, uid)
  return { settings, enabled: envelope.enabled }
}
