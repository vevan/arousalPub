import { PLUGIN_ID } from './constants.js'

export type PinnedTraceView = {
  turnOrdinal: number
  segmentIndex: number
}

export type LiveTailSnapshot = {
  turnOrdinal: number
  segmentIndex: number
  fingerprint: string
}

let pinnedConversationId: string | null = null
let pinnedView: PinnedTraceView | null = null
let activeConversationId: string | null = null
let liveTailByConversation: {
  conversationId: string
  tail: LiveTailSnapshot
} | null = null
let regeneratingConversationId: string | null = null
let regenerating = false
let panelRevision = 0

export function clearPinnedView(): void {
  pinnedConversationId = null
  pinnedView = null
}

export function clearLiveTailTracking(): void {
  liveTailByConversation = null
}

/** 切换会话时清除 pinned / regen / 尾迹快照；返回 true 表示会话 id 已变更 */
export function syncActiveConversation(conversationId: string): boolean {
  const cid = conversationId.trim()
  if (!cid) return false
  if (activeConversationId === cid) return false
  activeConversationId = cid
  clearPinnedView()
  clearLiveTailTracking()
  regenerating = false
  regeneratingConversationId = null
  return true
}

/**
 * 同会话 live 尾端前进（新 turn / 新 segment / 末段新 receive）时取消 pinned，回到 live 视图。
 * 返回 true 表示已清除 pinned。
 */
export function clearPinIfLiveTailAdvanced(
  conversationId: string,
  tail: LiveTailSnapshot | null,
): boolean {
  const cid = conversationId.trim()
  if (!cid) return false
  if (!tail) {
    if (liveTailByConversation?.conversationId === cid) {
      liveTailByConversation = null
    }
    return false
  }

  const prev =
    liveTailByConversation?.conversationId === cid
      ? liveTailByConversation.tail
      : null
  liveTailByConversation = { conversationId: cid, tail }

  const pinned = getPinnedView(cid)
  if (!prev || !pinned) return false

  const advanced =
    tail.turnOrdinal > prev.turnOrdinal ||
    (tail.turnOrdinal === prev.turnOrdinal &&
      (tail.segmentIndex > prev.segmentIndex ||
        (tail.segmentIndex === prev.segmentIndex &&
          tail.fingerprint !== prev.fingerprint)))

  if (!advanced) return false
  clearPinnedView()
  return true
}

/** @internal tests */
export function resetPinnedStateForTest(): void {
  activeConversationId = null
  clearLiveTailTracking()
  clearPinnedView()
  regenerating = false
  regeneratingConversationId = null
}

export function getPinnedView(conversationId: string): PinnedTraceView | null {
  const cid = conversationId.trim()
  if (!cid || pinnedConversationId !== cid) return null
  return pinnedView
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
