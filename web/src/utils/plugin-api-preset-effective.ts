export type PluginApiPresetEffectiveSource =
  | 'conversation'
  | 'global_plugin'
  | 'global_default'

export interface PluginApiPresetEffective {
  presetId: string
  source: PluginApiPresetEffectiveSource
}

function trimApiConfigId(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** 与 server §1.1 链对齐（UI 展示用，不含包内自维护 API） */
export function resolvePluginApiPresetEffective(opts: {
  conversationApiConfigId?: unknown
  globalPluginApiConfigId?: unknown
  activePresetId?: unknown
}): PluginApiPresetEffective | null {
  const conv = trimApiConfigId(opts.conversationApiConfigId)
  if (conv) return { presetId: conv, source: 'conversation' }

  const global = trimApiConfigId(opts.globalPluginApiConfigId)
  if (global) return { presetId: global, source: 'global_plugin' }

  const active = trimApiConfigId(opts.activePresetId)
  if (active) return { presetId: active, source: 'global_default' }

  return null
}

/** 全局插件 settings：仅 global apiConfigId → activePresetId */
export function resolveGlobalPluginApiPresetEffective(opts: {
  globalPluginApiConfigId?: unknown
  activePresetId?: unknown
}): PluginApiPresetEffective | null {
  const global = trimApiConfigId(opts.globalPluginApiConfigId)
  if (global) return { presetId: global, source: 'global_plugin' }

  const active = trimApiConfigId(opts.activePresetId)
  if (active) return { presetId: active, source: 'global_default' }

  return null
}

/** 仅返回 preset 别名；无别名或仅有 id 时返回 null（UI 不展示 id） */
export function apiPresetDisplayName(
  presetId: string,
  sources: {
    selectItems?: Array<{ value: string; title: string }>
    presets?: Array<{ id: string; alias?: string | null }>
  },
): string | null {
  const id = presetId.trim()
  if (!id) return null
  for (const p of sources.presets ?? []) {
    if (p.id !== id) continue
    const alias = typeof p.alias === 'string' ? p.alias.trim() : ''
    if (alias) return alias
  }
  for (const item of sources.selectItems ?? []) {
    if (item.value !== id) continue
    const title = item.title?.trim()
    if (title && title !== id) return title
  }
  return null
}

export type PluginApiPresetEffectiveI18nKey =
  | 'settings.plugins.apiPresetEffectiveSourceConversation'
  | 'settings.plugins.apiPresetEffectiveSourceGlobalPlugin'
  | 'settings.plugins.apiPresetEffectiveSourceGlobalDefault'

export function pluginApiPresetEffectiveSourceI18nKey(
  source: PluginApiPresetEffectiveSource,
): PluginApiPresetEffectiveI18nKey {
  if (source === 'conversation') {
    return 'settings.plugins.apiPresetEffectiveSourceConversation'
  }
  if (source === 'global_plugin') {
    return 'settings.plugins.apiPresetEffectiveSourceGlobalPlugin'
  }
  return 'settings.plugins.apiPresetEffectiveSourceGlobalDefault'
}

export type PluginApiPresetTranslate = (
  key: string,
  params?: Record<string, string>,
) => string

/** 当前生效预设：来源 - 预设名；无 preset 名时不展示 */
export function formatPluginApiPresetEffectiveHint(
  effective: PluginApiPresetEffective,
  presetName: string | null,
  translate: PluginApiPresetTranslate,
): string | null {
  const name = presetName?.trim()
  if (!name) return null
  const source = translate(pluginApiPresetEffectiveSourceI18nKey(effective.source))
  return translate('settings.plugins.apiPresetEffectiveLine', { source, name })
}
