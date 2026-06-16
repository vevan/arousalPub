import type { TraceKeeperSeparateDebug } from './separate-debug.js'
import type { PluginHost } from './types.js'

const AUDIT_DEBUG_STORAGE_KEY = 'arousal-chat-write-prompt-snapshot'

function readStoredAuditDebugPreference(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false
    const raw = localStorage.getItem(AUDIT_DEBUG_STORAGE_KEY)
    if (raw === '0' || raw === 'false') return false
    if (raw === '1' || raw === 'true') return true
  } catch {
    /* ignore */
  }
  return false
}

/** 设置页「启用会话 debug 审计」；读 session ref，回退 localStorage */
export function auditDebugEnabled(host: PluginHost): boolean {
  const raw = (
    host.session as { writeChatPromptSnapshot?: boolean | { value: boolean } }
  ).writeChatPromptSnapshot
  if (typeof raw === 'boolean') return raw
  if (raw && typeof raw === 'object' && 'value' in raw) {
    return Boolean(raw.value)
  }
  return readStoredAuditDebugPreference()
}

export function logSeparateDebugToConsole(debug: TraceKeeperSeparateDebug): void {
  const status =
    debug.code === 'ok' ? '成功' : debug.code ? `失败 (${debug.code})` : '完成'
  console.group(`[trace-keeper] Separate 补生成 debug · ${status}`)

  console.group('出站 messages')
  for (const [i, m] of (debug.messages ?? []).entries()) {
    console.log(`#${i + 1} [${m.role}]`, m.content)
  }
  console.groupEnd()

  console.group('入站响应')
  if (typeof debug.upstreamStatus === 'number') {
    console.log('HTTP', debug.upstreamStatus)
  }
  if (debug.assistantContent?.trim()) {
    console.log('assistant content:', debug.assistantContent)
  }
  if (
    debug.upstreamRawBody?.trim() &&
    debug.upstreamRawBody.trim() !== debug.assistantContent?.trim()
  ) {
    console.log('raw body:', debug.upstreamRawBody)
  }
  if (debug.upstreamPayload !== undefined) {
    console.log('upstream payload:', debug.upstreamPayload)
  }
  console.groupEnd()

  console.groupEnd()
}

export function logSeparateDebugIfPresent(
  debug: TraceKeeperSeparateDebug | undefined,
): void {
  if (!debug) return
  logSeparateDebugToConsole(debug)
}
