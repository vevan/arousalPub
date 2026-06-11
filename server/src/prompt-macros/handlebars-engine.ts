import Handlebars from 'handlebars'
import { resolveCharFirstMessage } from './character-fields.js'
import { stablePickFromArgs } from './macro-pick.js'
import {
  formatDatetimeParts,
  formatDatetimePattern,
  formatTimeWithUtcOffset,
  pickRandomArg,
  resolveAllChatRange,
  resolveAuthorsNote,
  resolveCurrentSwipeId,
  resolveDefaultAuthorsNote,
  resolveFirstIncludedMessageId,
  resolveHasExtension,
  resolveIdleDuration,
  resolveLastCharMessage,
  resolveLastMessage,
  resolveLastMessageId,
  resolveLastSwipeId,
  resolveLastUserMessage,
  resolveCharName,
  resolveContextLength,
  resolveInput,
  resolveLastGenerationType,
  resolveMaxResponseTokens,
  resolveModel,
  resolveNotChar,
  resolvePersona,
  resolvePrimaryField,
  resolveTimeDiff,
  resolveUserName,
  rollDiceSpec,
} from './macro-values.js'
import {
  preprocessLegacyAngleTags,
  preprocessLegacyMacroSyntax,
  preprocessStColonMacros,
} from './preprocess.js'
import { replaceUnsupportedMacroPlaceholders } from './unsupported.js'
import type { PromptMacroContext } from './types.js'

const COMPILE_CACHE_MAX = 512
const compileCache = new Map<string, Handlebars.TemplateDelegate>()

const handlebars = Handlebars.create()

function macroContext(options: Handlebars.HelperOptions): PromptMacroContext {
  return options.data.root as PromptMacroContext
}

function helperArgs(args: unknown[]): unknown[] {
  return args.slice(0, -1)
}

function repeatChar(ch: string, countRaw: unknown): string {
  const n = Number.parseInt(String(countRaw ?? 1), 10)
  const count = Number.isFinite(n) && n > 0 ? Math.min(n, 256) : 1
  return ch.repeat(count)
}

function registerSimple(
  name: string,
  fn: (ctx: PromptMacroContext, args: unknown[]) => string,
): void {
  handlebars.registerHelper(name, function (...args: unknown[]) {
    const options = args[args.length - 1] as Handlebars.HelperOptions
    return fn(macroContext(options), helperArgs(args))
  })
}

registerSimple('user', (ctx) => resolveUserName(ctx))
registerSimple('char', (ctx, args) => {
  if (args.length === 0) return resolveCharName(ctx, 1)
  const n = Number.parseInt(String(args[0]), 10)
  return resolveCharName(ctx, n)
})
registerSimple('model', (ctx) => resolveModel(ctx))
registerSimple('maxprompt', (ctx) => resolveContextLength(ctx))
registerSimple('context', (ctx) => resolveContextLength(ctx))
registerSimple('maxresponsetokens', (ctx) => resolveMaxResponseTokens(ctx))
registerSimple('input', (ctx) => resolveInput(ctx))
registerSimple('lastgenerationtype', (ctx) => resolveLastGenerationType(ctx))

registerSimple('date', (ctx) => formatDatetimeParts(ctx).date)
registerSimple('time', (ctx, args) => {
  if (args.length === 0) return formatDatetimeParts(ctx).time
  return formatTimeWithUtcOffset(ctx, String(args[0]))
})
registerSimple('datetime', (ctx) => formatDatetimeParts(ctx).datetime)
registerSimple('weekday', (ctx) => formatDatetimeParts(ctx).weekday)
registerSimple('isodate', (ctx) => formatDatetimeParts(ctx).isodate)
registerSimple('isotime', (ctx) => formatDatetimeParts(ctx).isotime)
registerSimple('datetimeformat', (ctx, args) => {
  const pattern = args.length > 0 ? String(args[0]) : 'YYYY-MM-DD HH:mm:ss'
  return formatDatetimePattern(ctx, pattern)
})
registerSimple('idleduration', (ctx) => resolveIdleDuration(ctx))
registerSimple('timediff', (ctx, args) =>
  resolveTimeDiff(
    ctx,
    args.length > 0 ? String(args[0]) : '',
    args.length > 1 ? String(args[1]) : '',
  ),
)

registerSimple('newline', (_ctx, args) => repeatChar('\n', args[0]))
registerSimple('space', (_ctx, args) => repeatChar(' ', args[0]))
registerSimple('noop', () => '')
registerSimple('trim', (_ctx, args) => {
  const s = args.length > 0 ? String(args[0]) : ''
  return s.trim()
})
registerSimple('reverse', (_ctx, args) => {
  const s = args.length > 0 ? String(args[0]) : ''
  return [...s].reverse().join('')
})
registerSimple('random', (_ctx, args) =>
  pickRandomArg(args.map((a) => String(a))),
)
registerSimple('roll', (_ctx, args) => {
  const spec = args.length > 0 ? String(args[0]) : '1d6'
  return rollDiceSpec(spec)
})

registerSimple('authorsnote', (ctx) => resolveAuthorsNote(ctx))
registerSimple('defaultauthorsnote', (ctx) => resolveDefaultAuthorsNote(ctx))
registerSimple('lastmessage', (ctx) => resolveLastMessage(ctx))
registerSimple('lastusermessage', (ctx) => resolveLastUserMessage(ctx))
registerSimple('lastcharmessage', (ctx) => resolveLastCharMessage(ctx))
registerSimple('lastmessageid', (ctx) => resolveLastMessageId(ctx))
registerSimple('firstincludedmessageid', (ctx) =>
  resolveFirstIncludedMessageId(ctx),
)
registerSimple('allchatrange', (ctx) => resolveAllChatRange(ctx))
registerSimple('lastswipeid', (ctx) => resolveLastSwipeId(ctx))
registerSimple('currentswipeid', (ctx) => resolveCurrentSwipeId(ctx))
registerSimple('notchar', (ctx) => resolveNotChar(ctx))
registerSimple('hasextension', (ctx, args) =>
  resolveHasExtension(ctx, args.length > 0 ? String(args[0]) : ''),
)
registerSimple('pick', (ctx, args) => {
  const conv = ctx.conversationId ?? ''
  return stablePickFromArgs(
    conv,
    args.map((a) => String(a)),
  )
})

registerSimple('description', (ctx) =>
  resolvePrimaryField(ctx, (f) => f.description),
)
registerSimple('personality', (ctx) =>
  resolvePrimaryField(ctx, (f) => f.personality),
)
registerSimple('scenario', (ctx) => resolvePrimaryField(ctx, (f) => f.scenario))
registerSimple('persona', (ctx) => resolvePersona(ctx))
registerSimple('mesexamples', (ctx) =>
  resolvePrimaryField(ctx, (f) => f.mesExample),
)
registerSimple('mesexamplesraw', (ctx) =>
  resolvePrimaryField(ctx, (f) => f.mesExample),
)
registerSimple('charprompt', (ctx) =>
  resolvePrimaryField(ctx, (f) => f.systemPrompt),
)
registerSimple('charinstruction', (ctx) =>
  resolvePrimaryField(ctx, (f) => f.postHistoryInstructions),
)
registerSimple('charcreatornotes', (ctx) =>
  resolvePrimaryField(ctx, (f) => f.creatorNotes),
)
registerSimple('charversion', (ctx) =>
  resolvePrimaryField(ctx, (f) => f.characterVersion),
)
registerSimple('chardepthprompt', (ctx) =>
  resolvePrimaryField(ctx, (f) => f.depthPrompt),
)
registerSimple('charfirstmessage', (ctx, args) =>
  resolveCharFirstMessage(ctx.primaryCharacter, args[0]),
)

function compileCached(source: string): Handlebars.TemplateDelegate {
  let tpl = compileCache.get(source)
  if (tpl) return tpl
  tpl = handlebars.compile(source, { noEscape: true, strict: false })
  if (compileCache.size >= COMPILE_CACHE_MAX) {
    const oldest = compileCache.keys().next().value
    if (oldest !== undefined) compileCache.delete(oldest)
  }
  compileCache.set(source, tpl)
  return tpl
}

/** 测试或热重载时清空 compile 缓存 */
export function clearMacroTemplateCache(): void {
  compileCache.clear()
}

export function renderPromptMacros(
  text: string,
  ctx: PromptMacroContext,
): string {
  let normalized = preprocessLegacyAngleTags(text)
  normalized = preprocessStColonMacros(normalized)
  normalized = replaceUnsupportedMacroPlaceholders(normalized)
  normalized = preprocessLegacyMacroSyntax(normalized)
  if (!normalized.includes('{{')) return normalized
  try {
    return compileCached(normalized)(ctx, { data: { root: ctx } })
  } catch {
    return normalized
  }
}
