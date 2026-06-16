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
