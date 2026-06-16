import { BLOCK_TAG, MAX_STATE_BYTES } from './constants.js'

const BLOCK_RE = new RegExp(
  `<${BLOCK_TAG}>\\s*([\\s\\S]*?)\\s*<\\/${BLOCK_TAG}>`,
  'gi',
)

function weakValidateState(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  return true
}

export function parseTraceKeeperJson(raw: string): Record<string, unknown> | null {
  const text = raw.trim()
  if (!text || text.length > MAX_STATE_BYTES) return null
  try {
    const parsed: unknown = JSON.parse(text)
    return weakValidateState(parsed) ? parsed : null
  } catch {
    return null
  }
}

/** 校验手动 patch / 编辑写回的 state（字符串或对象） */
export function normalizePatchState(raw: unknown): Record<string, unknown> | null {
  if (typeof raw === 'string') {
    return parseTraceKeeperJson(raw)
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const text = JSON.stringify(raw)
  if (!text || text.length > MAX_STATE_BYTES) return null
  return raw as Record<string, unknown>
}

export function stripTraceKeeperBlocks(assistantContent: string): string {
  return assistantContent.replace(BLOCK_RE, '').trim()
}

/** 取助手正文中最后一个有效 trace 块 */
export function extractTraceKeeperState(
  assistantContent: string,
): Record<string, unknown> | null {
  const content = assistantContent.trim()
  if (!content) return null
  let last: Record<string, unknown> | null = null
  for (const match of content.matchAll(BLOCK_RE)) {
    const inner = typeof match[1] === 'string' ? match[1] : ''
    const state = parseTraceKeeperJson(inner)
    if (state) last = state
  }
  return last
}

export type AssistantTraceDiagnosis =
  | { kind: 'no_block' }
  | { kind: 'empty_block' }
  | { kind: 'json_parse_failed'; detail?: string }
  | { kind: 'valid_json' }

function lastJsonParseError(raw: string): string | undefined {
  const text = raw.trim()
  if (!text) return undefined
  try {
    JSON.parse(text)
    return undefined
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return msg.length > 200 ? `${msg.slice(0, 200)}…` : msg
  }
}

/** 当前轮侧栏空态：诊断 active receive 正文（不落盘、不作 state fallback） */
export function diagnoseAssistantTrace(assistantContent: string): AssistantTraceDiagnosis {
  const content = assistantContent.trim()
  if (!content) return { kind: 'no_block' }

  BLOCK_RE.lastIndex = 0
  const blocks: string[] = []
  for (const match of content.matchAll(BLOCK_RE)) {
    blocks.push(typeof match[1] === 'string' ? match[1] : '')
  }
  if (blocks.length === 0) return { kind: 'no_block' }

  let sawNonEmpty = false
  let lastParseDetail: string | undefined
  for (const inner of blocks) {
    if (!inner.trim()) continue
    sawNonEmpty = true
    const state = parseTraceKeeperJson(inner)
    if (state) return { kind: 'valid_json' }
    lastParseDetail = lastJsonParseError(inner)
  }

  if (!sawNonEmpty) return { kind: 'empty_block' }
  return { kind: 'json_parse_failed', detail: lastParseDetail }
}
