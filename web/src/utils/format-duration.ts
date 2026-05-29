/** 将毫秒格式化为对话计时展示（如 3.2s、42s、1m 05s） */
export function formatDurationMs(ms: number): string {
  const n = Math.max(0, Math.round(ms))
  const s = n / 1000
  if (s < 10) return `${s.toFixed(1)}s`
  if (s < 60) return `${Math.round(s)}s`
  const m = Math.floor(s / 60)
  const rs = Math.round(s % 60)
  return `${m}m ${String(rs).padStart(2, '0')}s`
}
