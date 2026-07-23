import { k } from '../settings.js'
import { resolveMemoIndex } from './summarize.js'
import type { PluginHost, SummarizeTask } from '../types.js'

/** 通知用任务标题（不含资料库名） */
export function formatSummarizeTaskTitlePart(
  host: PluginHost,
  task: SummarizeTask,
  fromTurn: number,
  toTurn: number,
  blockTurns: number,
  memoIndex?: number,
): string {
  if (task.kind === 'sidecar') {
    return task.sidecar.name.trim()
  }
  const idx = resolveMemoIndex('', fromTurn, {
    blockTurns,
    ...(typeof memoIndex === 'number' ? { memoIndex } : {}),
  })
  const memo = String(idx).padStart(2, '0')
  const core = host.t(k(host, 'manualTaskMemory'))
  return `[MEMO-${memo}] ${core} [${fromTurn}-${toTurn}]`
}

/** 通知用完整标签：资料库名 - 任务标题 */
export function formatSummarizeTaskNotifyLabel(
  host: PluginHost,
  lorebookName: string,
  task: SummarizeTask,
  fromTurn: number,
  toTurn: number,
  blockTurns: number,
  memoIndex?: number,
): string {
  const book = lorebookName.trim()
  const part = formatSummarizeTaskTitlePart(
    host,
    task,
    fromTurn,
    toTurn,
    blockTurns,
    memoIndex,
  )
  return book ? `${book} - ${part}` : part
}
