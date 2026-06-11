import type { MacroCharacterFields } from './character-fields.js'
import {
  humanizeIdleDuration,
  humanizeTimeDiff,
} from './duration-humanize.js'
import type { PromptMacroContext } from './types.js'

const DEFAULT_CHAR_LABEL = '角色'
const DEFAULT_USER_LABEL = '用户'

/** camelCase / ST 别名 → 规范小写宏名 */
export const MACRO_HEAD_ALIASES: Record<string, string> = {
  maxprompt: 'maxprompt',
  maxcontexttokens: 'context',
  maxresponsetokens: 'maxresponsetokens',
  mesexamples: 'mesexamples',
  mesexamplesraw: 'mesexamplesraw',
  charprompt: 'charprompt',
  charinstruction: 'charinstruction',
  charcreatornotes: 'charcreatornotes',
  charversion: 'charversion',
  charfirstmessage: 'charfirstmessage',
  chardepthprompt: 'chardepthprompt',
  lastgenerationtype: 'lastgenerationtype',
  authorsnote: 'authorsnote',
  datetimeformat: 'datetimeformat',
  isodate: 'isodate',
  isotime: 'isotime',
  idleduration: 'idleduration',
  idle_duration: 'idleduration',
  timediff: 'timediff',
}

export function normalizeMacroHead(raw: string): string {
  const lower = raw.trim().toLowerCase()
  return MACRO_HEAD_ALIASES[lower] ?? lower
}

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

export function resolveMaxResponseTokens(ctx: PromptMacroContext): string {
  const n = ctx.maxResponseTokens
  if (typeof n === 'number' && !Number.isNaN(n) && n > 0) {
    return String(n)
  }
  return ''
}

export function resolveInput(ctx: PromptMacroContext): string {
  return ctx.userInput ?? ''
}

export function resolveLastGenerationType(ctx: PromptMacroContext): string {
  return ctx.lastGenerationType ?? ''
}

export function resolvePrimaryField(
  ctx: PromptMacroContext,
  pick: (f: MacroCharacterFields) => string,
): string {
  const f = ctx.primaryCharacter
  return f ? pick(f) : ''
}

export function resolvePersona(ctx: PromptMacroContext): string {
  const p = ctx.userPersona
  if (!p) return ''
  const desc = p.description.trim()
  if (desc) return desc
  return p.personality.trim()
}

export function formatDatetimeParts(ctx: PromptMacroContext): {
  date: string
  time: string
  datetime: string
  weekday: string
  isodate: string
  isotime: string
} {
  const d = ctx.now
  const locale = ctx.locale || 'en'
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
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(d)
  const isodate = formatIsoDate(d)
  const isotime = formatIsoTime(d)
  return { date, time, datetime: `${date} ${time}`, weekday, isodate, isotime }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function formatIsoDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

function formatIsoTime(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

export function formatDatetimePattern(ctx: PromptMacroContext, pattern: string): string {
  const d = ctx.now
  const locale = ctx.locale || 'en'
  const parts = formatDatetimeParts(ctx)
  let out = pattern
  out = out.replace(/YYYY/g, String(d.getFullYear()))
  out = out.replace(/YY/g, String(d.getFullYear()).slice(-2))
  out = out.replace(/MM/g, pad2(d.getMonth() + 1))
  out = out.replace(/DD/g, pad2(d.getDate()))
  out = out.replace(/HH/g, pad2(d.getHours()))
  out = out.replace(/mm/g, pad2(d.getMinutes()))
  out = out.replace(/ss/g, pad2(d.getSeconds()))
  out = out.replace(/dddd/g, parts.weekday)
  out = out.replace(/ddd/g, new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(d))
  return out
}

export function parseUtcOffsetMinutes(spec: string): number | null {
  const m = spec
    .trim()
    .match(/^(?:UTC|GMT)\s*([+-])\s*(\d{1,2})(?::(\d{2}))?$/i)
  if (!m) return null
  const sign = m[1] === '-' ? -1 : 1
  const hours = Number.parseInt(m[2]!, 10)
  const mins = m[3] ? Number.parseInt(m[3], 10) : 0
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return null
  return sign * (hours * 60 + mins)
}

export function formatTimeWithUtcOffset(ctx: PromptMacroContext, offsetSpec: string): string {
  const offsetMin = parseUtcOffsetMinutes(offsetSpec)
  if (offsetMin === null) {
    return formatDatetimeParts(ctx).time
  }
  const d = ctx.now
  const totalMin = d.getUTCHours() * 60 + d.getUTCMinutes() + offsetMin
  const wrapped = ((totalMin % (24 * 60)) + 24 * 60) % (24 * 60)
  const h = Math.floor(wrapped / 60)
  const min = wrapped % 60
  const sec = d.getUTCSeconds()
  return `${pad2(h)}:${pad2(min)}:${pad2(sec)}`
}

export function resolveAuthorsNote(ctx: PromptMacroContext): string {
  return ctx.authorsNote ?? ''
}

export function resolveDefaultAuthorsNote(ctx: PromptMacroContext): string {
  return ctx.defaultAuthorsNote ?? ''
}

export function resolveLastMessage(ctx: PromptMacroContext): string {
  return ctx.lastMessage ?? ''
}

export function resolveLastUserMessage(ctx: PromptMacroContext): string {
  return ctx.lastUserMessage ?? ''
}

export function resolveLastCharMessage(ctx: PromptMacroContext): string {
  return ctx.lastCharMessage ?? ''
}

export function resolveLastMessageId(ctx: PromptMacroContext): string {
  return ctx.lastMessageId ?? '0'
}

export function resolveFirstIncludedMessageId(ctx: PromptMacroContext): string {
  return ctx.firstIncludedMessageId ?? '0'
}

export function resolveAllChatRange(ctx: PromptMacroContext): string {
  return ctx.allChatRange ?? '0-0'
}

export function resolveLastSwipeId(ctx: PromptMacroContext): string {
  return ctx.lastSwipeId ?? '0'
}

export function resolveCurrentSwipeId(ctx: PromptMacroContext): string {
  return ctx.currentSwipeId ?? '0'
}

export function resolveNotChar(ctx: PromptMacroContext): string {
  return ctx.notChar ?? ''
}

export function resolveIdleDuration(ctx: PromptMacroContext): string {
  return humanizeIdleDuration(ctx.idleReferenceUserAt, ctx.now, ctx.locale)
}

export function resolveTimeDiff(
  ctx: PromptMacroContext,
  left: string,
  right: string,
): string {
  return humanizeTimeDiff(left, right, ctx.locale)
}

export function resolveHasExtension(
  ctx: PromptMacroContext,
  name: string,
): string {
  const n = name.trim().toLowerCase()
  if (!n) return 'false'
  const ids = ctx.enabledPluginIds ?? []
  return ids.some((id) => id.toLowerCase() === n) ? 'true' : 'false'
}

export function rollDiceSpec(spec: string): string {
  const m = spec.trim().match(/^(\d+)d(\d+)(?:([+-])(\d+))?$/i)
  if (!m) return ''
  const count = Number.parseInt(m[1]!, 10)
  const sides = Number.parseInt(m[2]!, 10)
  if (!Number.isFinite(count) || !Number.isFinite(sides) || count < 1 || sides < 1) {
    return ''
  }
  let sum = 0
  for (let i = 0; i < count; i++) {
    sum += Math.floor(Math.random() * sides) + 1
  }
  if (m[3] && m[4]) {
    const mod = Number.parseInt(m[4], 10)
    if (Number.isFinite(mod)) {
      sum += m[3] === '-' ? -mod : mod
    }
  }
  return String(sum)
}

export function pickRandomArg(args: string[]): string {
  if (args.length === 0) return ''
  const i = Math.floor(Math.random() * args.length)
  return args[i] ?? ''
}

/** 简单宏名（不含 charN 数字后缀形态） */
export const KNOWN_MACRO_HEADS = new Set([
  'user',
  'char',
  'date',
  'time',
  'datetime',
  'weekday',
  'isodate',
  'isotime',
  'datetimeformat',
  'idleduration',
  'timediff',
  'model',
  'maxprompt',
  'context',
  'maxresponsetokens',
  'newline',
  'space',
  'noop',
  'trim',
  'reverse',
  'random',
  'roll',
  'authorsnote',
  'defaultauthorsnote',
  'lastmessage',
  'lastusermessage',
  'lastcharmessage',
  'lastmessageid',
  'firstincludedmessageid',
  'allchatrange',
  'lastswipeid',
  'currentswipeid',
  'notchar',
  'hasextension',
  'pick',
  'description',
  'personality',
  'scenario',
  'persona',
  'mesexamples',
  'mesexamplesraw',
  'charprompt',
  'charinstruction',
  'charcreatornotes',
  'charversion',
  'charfirstmessage',
  'chardepthprompt',
  'input',
  'lastgenerationtype',
])

/** 支持 `{{name::arg}}` ST 语法的宏头 */
export const COLON_MACRO_HEADS = new Set([
  'datetimeformat',
  'time',
  'space',
  'newline',
  'reverse',
  'random',
  'roll',
  'charfirstmessage',
  'trim',
  'pick',
  'hasextension',
  'timediff',
])

export function macroTokenHead(inner: string): string {
  const raw = inner.trim()
  if (!raw) return ''
  if (raw.includes('::')) {
    return normalizeMacroHead(raw.split('::')[0]!)
  }
  return normalizeMacroHead(raw.split(/\s+/)[0]!)
}

export function isKnownMacroToken(inner: string): boolean {
  const raw = inner.trim()
  if (!raw) return false
  const head = macroTokenHead(raw)
  if (KNOWN_MACRO_HEADS.has(head)) return true
  if (/^char\d+$/i.test(head)) return true
  return false
}

export function unsupportedMacroPlaceholder(inner: string): string {
  const name = inner.trim()
  return name ? `[${name} UNSUPPORTED]` : '[UNSUPPORTED]'
}

export function renderFailMacroPlaceholder(inner: string): string {
  const name = inner.trim()
  return name ? `[${name} RENDERFAIL]` : '[RENDERFAIL]'
}
