/** 与 curated-memory 插件 settings.ts 中自动块逻辑对齐（纯函数，供对话设置 UI） */

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

export interface MemorybookProgressView {
  memorybookEnabled: boolean
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

export function computeMemorybookProgress(
  conv: Record<string, unknown>,
  global: Record<string, unknown>,
): MemorybookProgressView {
  const memorybookEnabled = conv.memorybookEnabled === true
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
  const nextBlockStart =
    typeof conv.nextBlockStart === 'number' && Number.isFinite(conv.nextBlockStart)
      ? Math.max(0, Math.round(conv.nextBlockStart))
      : 0
  let lastSummarizedEnd: number | null = null
  if (typeof conv.lastSummarizedEnd === 'number' && Number.isFinite(conv.lastSummarizedEnd)) {
    lastSummarizedEnd = Math.round(conv.lastSummarizedEnd)
  } else if (
    typeof conv.lastTriggeredTurnOrdinal === 'number' &&
    Number.isFinite(conv.lastTriggeredTurnOrdinal)
  ) {
    lastSummarizedEnd = Math.round(conv.lastTriggeredTurnOrdinal)
  }
  const pendingToTurn = blockEndFromStart(nextBlockStart, blockTurns)
  const nextTriggerTurn = firstAutoTriggerTurnOrdinal(
    nextBlockStart,
    blockTurns,
    bufferTurns,
  )
  return {
    memorybookEnabled,
    lastSummarizedEnd,
    nextBlockStart,
    pendingFromTurn: nextBlockStart,
    pendingToTurn,
    nextTriggerTurn,
  }
}

/** 用户手动校正自动摘要指针；null 表示尚未摘要 */
export function buildMemorybookPointerResetPatch(
  lastSummarizedEnd: number | null,
): Record<string, unknown> {
  if (lastSummarizedEnd === null) {
    return {
      lastSummarizedEnd: null,
      nextBlockStart: 0,
      lastTriggeredTurnOrdinal: null,
    }
  }
  const end = Math.max(-1, Math.round(lastSummarizedEnd))
  return {
    lastSummarizedEnd: end,
    nextBlockStart: end + 1,
    lastTriggeredTurnOrdinal: null,
  }
}

export function readLastSummarizedEnd(conv: Record<string, unknown>): number | null {
  if (typeof conv.lastSummarizedEnd === 'number' && Number.isFinite(conv.lastSummarizedEnd)) {
    return Math.round(conv.lastSummarizedEnd)
  }
  if (
    typeof conv.lastTriggeredTurnOrdinal === 'number' &&
    Number.isFinite(conv.lastTriggeredTurnOrdinal)
  ) {
    return Math.round(conv.lastTriggeredTurnOrdinal)
  }
  return null
}
