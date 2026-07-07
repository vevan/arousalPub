import type { PluginSettingsBundleSelectConfig } from '@/plugins/plugin-settings-types'
import { pluginI18nKey } from '@/utils/plugin-settings-api'
import { parseObjectListField } from '@/utils/plugin-settings-validate'

export interface PluginBundleSelectItem {
  title: string
  value: string
}

export function pluginSettingsBundleSelectItems(
  model: Record<string, unknown>,
  pluginId: string,
  config: PluginSettingsBundleSelectConfig,
  t: (key: string) => string,
  te: (key: string) => boolean,
): PluginBundleSelectItem[] {
  const items: PluginBundleSelectItem[] = []
  const seen = new Set<string>()

  if (config.inheritOption) {
    const inheritKey = config.inheritLabelKey
      ? pluginI18nKey(pluginId, config.inheritLabelKey)
      : ''
    const inheritTitle =
      inheritKey && te(inheritKey) ? t(inheritKey) : 'Inherit default'
    items.push({ title: inheritTitle, value: '' })
  }

  if (config.builtinValue) {
    const builtinKey = config.builtinLabelKey
      ? pluginI18nKey(pluginId, config.builtinLabelKey)
      : ''
    const builtinTitle =
      builtinKey && te(builtinKey)
        ? t(builtinKey)
        : config.builtinValue
    items.push({ title: builtinTitle, value: config.builtinValue })
    seen.add(config.builtinValue)
  }

  for (const raw of parseObjectListField(model[config.listFieldKey])) {
    const id = String(raw.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const label = String(raw.label ?? '').trim()
    items.push({ title: label || id, value: id })
  }
  return items
}
