/** 各会话 Composer 输入历史（localStorage，与聊天 turns 分离） */
export const COMPOSER_INPUT_HISTORY_STORAGE_PREFIX =
  'arousal-composer-input-history'

import {
  COMPOSER_INPUT_HISTORY_PINNED_MAX_DEFAULT,
  COMPOSER_INPUT_HISTORY_RECENT_MAX_DEFAULT,
  type ComposerInputHistoryLimits,
  normalizeComposerInputHistoryLimits,
} from './composer-input-history-limits.js'

export const COMPOSER_INPUT_HISTORY_RECENT_MAX =
  COMPOSER_INPUT_HISTORY_RECENT_MAX_DEFAULT
export const COMPOSER_INPUT_HISTORY_PINNED_MAX =
  COMPOSER_INPUT_HISTORY_PINNED_MAX_DEFAULT
export const COMPOSER_INPUT_HISTORY_ITEM_MAX_CHARS = 10_000

export interface ComposerInputHistory {
  version: 1
  pinned: string[]
  recent: string[]
}

export type PinInputHistoryResult =
  | { ok: true; history: ComposerInputHistory }
  | { ok: false; reason: 'pinned_max' | 'not_found' }

export function composerInputHistoryStorageKey(
  conversationId: string,
  userId?: string | null,
): string {
  const uid = typeof userId === 'string' && userId.trim() ? userId.trim() : 'anonymous'
  const cid = conversationId.trim()
  return `${COMPOSER_INPUT_HISTORY_STORAGE_PREFIX}:${uid}:${cid}`
}

export function createEmptyComposerInputHistory(): ComposerInputHistory {
  return { version: 1, pinned: [], recent: [] }
}

function clipHistoryText(text: string): string {
  if (text.length <= COMPOSER_INPUT_HISTORY_ITEM_MAX_CHARS) return text
  return text.slice(0, COMPOSER_INPUT_HISTORY_ITEM_MAX_CHARS)
}

function withoutText(items: string[], text: string): string[] {
  return items.filter((t) => t !== text)
}

function trimRecentHead(
  recent: string[],
  recentMax: number,
): string[] {
  if (recent.length <= recentMax) return recent
  return recent.slice(recent.length - recentMax)
}

function trimPinnedHead(
  pinned: string[],
  pinnedMax: number,
): string[] {
  if (pinned.length <= pinnedMax) return pinned
  return pinned.slice(pinned.length - pinnedMax)
}

export function trimComposerInputHistoryToLimits(
  history: ComposerInputHistory,
  limits?: Partial<ComposerInputHistoryLimits>,
): ComposerInputHistory {
  const { pinnedMax, recentMax } = normalizeComposerInputHistoryLimits(limits)
  return {
    version: 1,
    pinned: trimPinnedHead(history.pinned, pinnedMax),
    recent: trimRecentHead(history.recent, recentMax),
  }
}

export function normalizeComposerInputHistory(
  raw: unknown,
  limits?: Partial<ComposerInputHistoryLimits>,
): ComposerInputHistory {
  if (!raw || typeof raw !== 'object') return createEmptyComposerInputHistory()
  const o = raw as { pinned?: unknown; recent?: unknown }
  const pinned = Array.isArray(o.pinned)
    ? o.pinned.filter((t): t is string => typeof t === 'string' && t.length > 0)
    : []
  const recent = Array.isArray(o.recent)
    ? o.recent.filter((t): t is string => typeof t === 'string' && t.length > 0)
    : []
  const pinnedSet = new Set<string>()
  const dedupedPinned: string[] = []
  for (const t of pinned) {
    if (pinnedSet.has(t)) continue
    pinnedSet.add(t)
    dedupedPinned.push(t)
  }
  const recentSet = new Set(pinnedSet)
  const dedupedRecent: string[] = []
  for (const t of recent) {
    if (recentSet.has(t)) continue
    recentSet.add(t)
    dedupedRecent.push(t)
  }
  const { pinnedMax, recentMax } = normalizeComposerInputHistoryLimits(limits)
  return trimComposerInputHistoryToLimits(
    {
      version: 1,
      pinned: dedupedPinned,
      recent: dedupedRecent,
    },
    { pinnedMax, recentMax },
  )
}

export function readComposerInputHistory(
  conversationId: string,
  userId?: string | null,
  limits?: Partial<ComposerInputHistoryLimits>,
): ComposerInputHistory {
  const cid = conversationId.trim()
  if (!cid) return createEmptyComposerInputHistory()
  try {
    const raw = localStorage.getItem(composerInputHistoryStorageKey(cid, userId))
    if (!raw) return createEmptyComposerInputHistory()
    return normalizeComposerInputHistory(JSON.parse(raw) as unknown, limits)
  } catch {
    return createEmptyComposerInputHistory()
  }
}

export function writeComposerInputHistory(
  conversationId: string,
  history: ComposerInputHistory,
  userId?: string | null,
  limits?: Partial<ComposerInputHistoryLimits>,
): void {
  const cid = conversationId.trim()
  if (!cid) return
  const key = composerInputHistoryStorageKey(cid, userId)
  try {
    const normalized = normalizeComposerInputHistory(history, limits)
    if (normalized.pinned.length === 0 && normalized.recent.length === 0) {
      localStorage.removeItem(key)
      return
    }
    localStorage.setItem(key, JSON.stringify(normalized))
  } catch {
    /* quota / private mode */
  }
}

/** 点发送时写入；新内容追加到对应分组尾部，重复则移到该组尾部 */
export function pushComposerInputHistoryOnSend(
  history: ComposerInputHistory,
  rawText: string,
  opts?: { recentMax?: number },
): ComposerInputHistory {
  const text = clipHistoryText(rawText.trim())
  if (!text) return history

  const recentMax = opts?.recentMax ?? COMPOSER_INPUT_HISTORY_RECENT_MAX
  let { pinned, recent } = history

  if (pinned.includes(text)) {
    pinned = [...withoutText(pinned, text), text]
    return { version: 1, pinned, recent: withoutText(recent, text) }
  }

  recent = withoutText(recent, text)
  recent = [...recent, text]
  recent = trimRecentHead(recent, recentMax)
  return { version: 1, pinned, recent }
}

export function pinComposerInputHistoryItem(
  history: ComposerInputHistory,
  rawText: string,
  opts?: { pinnedMax?: number },
): PinInputHistoryResult {
  const text = rawText.trim()
  if (!text) return { ok: false, reason: 'not_found' }

  const pinnedMax = opts?.pinnedMax ?? COMPOSER_INPUT_HISTORY_PINNED_MAX
  let { pinned, recent } = history
  const inPinned = pinned.includes(text)
  const inRecent = recent.includes(text)
  if (!inPinned && !inRecent) return { ok: false, reason: 'not_found' }

  if (inPinned) {
    pinned = [...withoutText(pinned, text), text]
    return {
      ok: true,
      history: { version: 1, pinned, recent: withoutText(recent, text) },
    }
  }

  if (pinned.length >= pinnedMax) {
    return { ok: false, reason: 'pinned_max' }
  }

  recent = withoutText(recent, text)
  pinned = [...pinned, text]
  return { ok: true, history: { version: 1, pinned, recent } }
}

export function unpinComposerInputHistoryItem(
  history: ComposerInputHistory,
  rawText: string,
  opts?: { recentMax?: number },
): ComposerInputHistory {
  const text = rawText.trim()
  if (!text || !history.pinned.includes(text)) return history

  const recentMax = opts?.recentMax ?? COMPOSER_INPUT_HISTORY_RECENT_MAX
  let { pinned, recent } = history
  pinned = withoutText(pinned, text)
  recent = withoutText(recent, text)
  recent = [...recent, text]
  recent = trimRecentHead(recent, recentMax)
  return { version: 1, pinned, recent }
}
