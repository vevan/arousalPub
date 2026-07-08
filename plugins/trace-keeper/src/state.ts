import { PLUGIN_ID } from './constants.js'

export type PinnedTraceView = {
  turnOrdinal: number
  segmentIndex: number
}

let pinnedConversationId: string | null = null
let pinnedView: PinnedTraceView | null = null
let activeConversationId: string | null = null
let regeneratingConversationId: string | null = null
let regenerating = false
let panelRevision = 0

export function clearPinnedView(): void {
  pinnedConversationId = null
  pinnedView = null
}

/** 切换会话时清除 pinned / regen 标记；返回 true 表示会话 id 已变更 */
export function syncActiveConversation(conversationId: string): boolean {
  const cid = conversationId.trim()
  if (!cid) return false
  if (activeConversationId === cid) return false
  activeConversationId = cid
  clearPinnedView()
  regenerating = false
  regeneratingConversationId = null
  return true
}

export function getPinnedView(conversationId: string): PinnedTraceView | null {
  const cid = conversationId.trim()
  if (!cid || pinnedConversationId !== cid) return null
  return pinnedView
}

/** @deprecated 使用 getPinnedView */
export function getPinnedTurnOrdinal(conversationId: string): number | null {
  return getPinnedView(conversationId)?.turnOrdinal ?? null
}

export function setPinnedView(
  conversationId: string,
  view: PinnedTraceView | null,
): void {
  const cid = conversationId.trim()
  if (!cid || view == null) {
    clearPinnedView()
    return
  }
  pinnedConversationId = cid
  pinnedView = {
    turnOrdinal: view.turnOrdinal,
    segmentIndex: Math.max(0, Math.floor(view.segmentIndex)),
  }
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

export const PLACEMENT = 'leftRail' as const

export function pluginPanelId(): string {
  return PLUGIN_ID
}
