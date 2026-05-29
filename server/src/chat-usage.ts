/** OpenAI 兼容 chat/completions 的 usage 字段解析 */

export function extractCompletionTokens(payload: unknown): number | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const usage = (payload as { usage?: unknown }).usage
  if (!usage || typeof usage !== 'object') return undefined
  const u = usage as Record<string, unknown>
  const raw =
    typeof u.completion_tokens === 'number'
      ? u.completion_tokens
      : typeof u.completionTokens === 'number'
        ? u.completionTokens
        : undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) {
    return undefined
  }
  return Math.round(raw)
}
