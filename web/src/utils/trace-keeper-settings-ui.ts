import { pluginI18nKey } from '@/utils/plugin-settings-api'
import { parseObjectListField } from '@/utils/plugin-settings-validate'

export const TRACE_KEEPER_PLUGIN_ID = 'trace-keeper'
export const TRACE_KEEPER_BUILTIN_BUNDLE_ID = 'scene-tracker-default'

export interface TraceKeeperBundleSelectItem {
  title: string
  value: string
}

export function traceKeeperBundleSelectItems(
  model: Record<string, unknown>,
  pluginId: string,
  t: (key: string) => string,
  te: (key: string) => boolean,
): TraceKeeperBundleSelectItem[] {
  const builtinKey = pluginI18nKey(pluginId, 'bundleBuiltinOption')
  const builtinTitle = te(builtinKey)
    ? t(builtinKey)
    : 'Built-in scene tracker (default)'

  const items: TraceKeeperBundleSelectItem[] = [
    { title: builtinTitle, value: TRACE_KEEPER_BUILTIN_BUNDLE_ID },
  ]

  const seen = new Set<string>([TRACE_KEEPER_BUILTIN_BUNDLE_ID])
  for (const raw of parseObjectListField(model.bundleList)) {
    const id = String(raw.id ?? '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    const label = String(raw.label ?? '').trim()
    items.push({ title: label || id, value: id })
  }
  return items
}

export function traceKeeperConvBundleSelectItems(
  globalModel: Record<string, unknown>,
  pluginId: string,
  t: (key: string) => string,
  te: (key: string) => boolean,
): TraceKeeperBundleSelectItem[] {
  const inheritKey = pluginI18nKey(pluginId, 'convBundleInheritOption')
  const inheritTitle = te(inheritKey) ? t(inheritKey) : 'Inherit default'
  return [
    { title: inheritTitle, value: '' },
    ...traceKeeperBundleSelectItems(globalModel, pluginId, t, te),
  ]
}
