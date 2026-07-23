import { ref } from 'vue'
import type { PluginSettingsCompanionPanelDef } from '@/plugins/types'

const panels = new Map<string, PluginSettingsCompanionPanelDef>()

/** 注册变更时递增，供设置页 computed 追踪（不依赖 Vue inject 树） */
export const settingsCompanionRevision = ref(0)

export function settingsCompanionKey(pluginId: string, panelId: string): string {
  return `${pluginId.trim()}::${panelId.trim()}`
}

export function registerSettingsCompanionPanel(
  pluginId: string,
  def: PluginSettingsCompanionPanelDef,
): void {
  const panelId = def.id.trim()
  if (!panelId) return
  panels.set(settingsCompanionKey(pluginId, panelId), def)
  settingsCompanionRevision.value += 1
}

export function getSettingsCompanionPanel(
  pluginId: string,
  panelId: string,
): PluginSettingsCompanionPanelDef | null {
  void settingsCompanionRevision.value
  return panels.get(settingsCompanionKey(pluginId, panelId)) ?? null
}
