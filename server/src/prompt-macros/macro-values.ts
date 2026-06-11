import type { PromptMacroContext } from './types.js'

const DEFAULT_CHAR_LABEL = '角色'
const DEFAULT_USER_LABEL = '用户'

export function resolveUserName(ctx: PromptMacroContext): string {
  const u = ctx.userName.trim()
  return u || DEFAULT_USER_LABEL
}

export function resolveCharName(ctx: PromptMacroContext, index1: number): string {
  if (!Number.isFinite(index1) || index1 < 1) return ''
  const v = ctx.characterNames[index1 - 1]?.trim()
  if (index1 === 1) return v || DEFAULT_CHAR_LABEL
  return v ?? ''
}

export function resolveModel(ctx: PromptMacroContext): string {
  return ctx.model?.trim() ?? ''
}

export function resolveContextLength(ctx: PromptMacroContext): string {
  const n = ctx.contextLength
  if (typeof n === 'number' && !Number.isNaN(n) && n > 0) {
    return String(Math.floor(n))
  }
  return ''
}

export function formatDatetimeParts(ctx: PromptMacroContext): {
  date: string
  time: string
  datetime: string
} {
  const d = ctx.now
  const locale = ctx.locale || 'zh-CN'
  const date = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d)
  return { date, time, datetime: `${date} ${time}` }
}

export function resolveAuthorsNote(ctx: PromptMacroContext): string {
  return ctx.authorsNote ?? ''
}

/** 简单宏名（不含 charN 数字后缀形态） */
export const KNOWN_MACRO_HEADS = new Set([
  'user',
  'char',
  'date',
  'time',
  'datetime',
  'model',
  'maxprompt',
  'context',
  'newline',
  'authorsnote',
])

export function isKnownMacroToken(inner: string): boolean {
  const raw = inner.trim()
  if (!raw || raw.startsWith('#') || raw.startsWith('/') || raw.startsWith('!')) {
    return true
  }
  if (raw.startsWith('else')) return true
  const head = raw.split(/\s+/)[0]!.toLowerCase()
  if (KNOWN_MACRO_HEADS.has(head)) return true
  if (/^char\d+$/i.test(head)) return true
  return false
}

export function unsupportedMacroPlaceholder(inner: string): string {
  const name = inner.trim()
  return name ? `[${name} UNSUPPORTED]` : '[UNSUPPORTED]'
}
