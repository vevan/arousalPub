/** 与宏索引窗口 `MACRO_INDEXING_TURN_CAP` 对齐；超出后扩宏/历史类宏语义可能偏离 */
export const SUMMARIZE_TURN_SPAN_HINT_MAX = 512

export function summarizeTurnSpan(fromTurn: number, toTurn: number): number {
  return Math.max(0, toTurn - fromTurn + 1)
}

export function isSummarizeTurnSpanTooLarge(
  fromTurn: number,
  toTurn: number,
): boolean {
  return summarizeTurnSpan(fromTurn, toTurn) > SUMMARIZE_TURN_SPAN_HINT_MAX
}
