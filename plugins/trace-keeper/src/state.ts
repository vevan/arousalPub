import { PLUGIN_ID } from './constants.js'

let pinnedConversationId: string | null = null
let pinnedTurnOrdinal: number | null = null
let regeneratingConversationId: string | null = null
let regenerating = false
let panelRevision = 0

export function getPinnedTurnOrdinal(conversationId: string): number | null {
  const cid = conversationId.trim()
  if (!cid || pinnedConversationId !== cid) return null
  return pinnedTurnOrdinal
}

export function setPinnedTurnOrdinal(
  conversationId: string,
  ord: number | null,
): void {
  const cid = conversationId.trim()
  if (!cid || ord == null) {
    pinnedConversationId = null
    pinnedTurnOrdinal = null
    return
  }
  pinnedConversationId = cid
  pinnedTurnOrdinal = ord
}

export function isRegenerating(conversationId: string): boolean {
  const cid = conversationId.trim()
  return regenerating && regeneratingConversationId === cid
}

export function setRegenerating(conversationId: string, value: boolean): void {
  const cid = conversationId.trim()
  if (!value || !cid) {
    regenerating = false
    regeneratingConversationId = null
    return
  }
  regenerating = true
  regeneratingConversationId = cid
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
