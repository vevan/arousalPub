import {
  normalizedNextBlockStart,
  readLastSummarizedEnd,
} from './settings.js'

export { normalizedNextBlockStart }

function asInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, Math.round(n)))
}

function effectiveInt(
  conv: Record<string, unknown>,
  global: Record<string, unknown>,
  convKey: string,
  globalKey: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = conv[convKey] ?? global[globalKey]
  return asInt(raw, fallback, min, max)
}

export interface AutoSummarizeProgressView {
  autoSummarizeEnabled: boolean
  lastSummarizedEnd: number | null
  nextBlockStart: number
  pendingFromTurn: number
  pendingToTurn: number
  nextTriggerTurn: number
}

export function blockEndFromStart(start: number, blockTurns: number): number {
  return start + blockTurns - 1
}

export function firstAutoTriggerTurnOrdinal(
  nextBlockStart: number,
  blockTurns: number,
  bufferTurns: number,
): number {
  return blockEndFromStart(nextBlockStart, blockTurns) + bufferTurns
}

export function computeAutoSummarizeProgress(
  conv: Record<string, unknown>,
  global: Record<string, unknown>,
): AutoSummarizeProgressView {
  const autoSummarizeEnabled = conv.autoSummarizeEnabled === true
  const blockTurns = effectiveInt(
    conv,
    global,
    'blockTurns',
    'triggerEveryNTurns',
    4,
    1,
    500,
  )
  const bufferTurns = effectiveInt(conv, global, 'bufferTurns', 'bufferTurns', 5, 0, 500)
  const lastRaw = readLastSummarizedEnd(conv)
  const lastSummarizedEnd =
    typeof lastRaw === 'number' ? lastRaw : null
  const rawNextBlockStart =
    typeof conv.nextBlockStart === 'number' && Number.isFinite(conv.nextBlockStart)
      ? Math.max(0, Math.round(conv.nextBlockStart))
      : 0
  const nextBlockStart = normalizedNextBlockStart(rawNextBlockStart, lastRaw)
  const pendingToTurn = blockEndFromStart(nextBlockStart, blockTurns)
  const nextTriggerTurn = firstAutoTriggerTurnOrdinal(
    nextBlockStart,
    blockTurns,
    bufferTurns,
  )
  return {
    autoSummarizeEnabled,
    lastSummarizedEnd,
    nextBlockStart,
    pendingFromTurn: nextBlockStart,
    pendingToTurn,
    nextTriggerTurn,
  }
}

/** 用户手动校正自动摘要指针；null 表示尚未摘要 */
export function buildAutoSummarizePointerResetPatch(
  lastSummarizedEnd: number | null,
  lastMemoIndex?: number | null,
): Record<string, unknown> {
  const patch: Record<string, unknown> =
    lastSummarizedEnd === null
      ? {
          lastSummarizedEnd: null,
          nextBlockStart: 0,
          lastTriggeredTurnOrdinal: null,
        }
      : {
          lastSummarizedEnd: Math.max(-1, Math.round(lastSummarizedEnd)),
          nextBlockStart: Math.max(-1, Math.round(lastSummarizedEnd)) + 1,
          lastTriggeredTurnOrdinal: null,
        }
  if (lastMemoIndex === null) {
    patch.lastMemoIndex = null
  } else if (
    typeof lastMemoIndex === 'number' &&
    Number.isFinite(lastMemoIndex) &&
    lastMemoIndex >= 1
  ) {
    patch.lastMemoIndex = Math.round(lastMemoIndex)
  }
  return patch
}
