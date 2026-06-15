import { PLUGIN_ID } from './constants.js'

let pinnedTurnOrdinal: number | null = null
let panelRevision = 0

export function getPinnedTurnOrdinal(): number | null {
  return pinnedTurnOrdinal
}

export function setPinnedTurnOrdinal(ord: number | null): void {
  pinnedTurnOrdinal = ord
}

export function bumpPanelRevision(): number {
  panelRevision += 1
  return panelRevision
}

export function getPanelRevision(): number {
  return panelRevision
}

export function k(host: { pluginKey: (key: string) => string }, key: string): string {
  return host.pluginKey(key)
}

export const PLACEMENT = 'leftDrawer' as const

export function pluginPanelId(): string {
  return PLUGIN_ID
}
