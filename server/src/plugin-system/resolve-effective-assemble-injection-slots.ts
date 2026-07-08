import {
  clampInjectionOrder,
  type AssembleInjectionOrderSlots,
} from '../shared/post-user-injection-order.js'
import {
  getAssembleInjectionOrderPolicy,
} from './assemble-injection-order-policies.js'
import { readMergedPluginUserSettings } from './settings.js'

/** manifest 默认 slots + 用户插件 settings 覆盖（slotSettingsKeys 映射） */
export async function resolveEffectiveAssembleInjectionOrderSlots(
  pluginId: string,
): Promise<AssembleInjectionOrderSlots> {
  const policy = getAssembleInjectionOrderPolicy(pluginId)
  const out: AssembleInjectionOrderSlots = { ...policy.slots }
  const keys = Object.entries(policy.slotSettingsKeys)
  if (keys.length === 0) return out

  const settings = await readMergedPluginUserSettings(pluginId)
  for (const [slotKey, settingsKey] of keys) {
    const raw = settings[settingsKey]
    if (typeof raw === 'number' && Number.isFinite(raw)) {
      out[slotKey] = clampInjectionOrder(raw)
    }
  }
  return out
}
