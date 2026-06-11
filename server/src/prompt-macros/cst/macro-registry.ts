import { resolveCharFirstMessage } from '../character-fields.js'
import { stablePickFromArgs } from '../macro-pick.js'
import {
  getGlobalVar,
  getLocalVar,
  resolveHasGlobalVarMacro,
  resolveHasVarMacro,
  setGlobalVar,
  setLocalVar,
} from '../macro-vars.js'
import type { ParsedMacroTag } from '../macro-tag-parse.js'
import {
  COLON_MACRO_HEADS,
  formatDatetimeParts,
  formatDatetimePattern,
  formatTimeWithUtcOffset,
  isKnownMacroToken,
  normalizeMacroHead,
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
  unsupportedMacroPlaceholder,
} from '../macro-values.js'
import { trimScopedBlockContent } from '../macro-truthy.js'
import type { PromptMacroContext } from '../types.js'

function repeatChar(ch: string, countRaw: string | undefined): string {
  const n = Number.parseInt(String(countRaw ?? 1), 10)
  const count = Number.isFinite(n) && n > 0 ? Math.min(n, 256) : 1
  return ch.repeat(count)
}

export function macroTagArgs(tag: ParsedMacroTag): string[] {
  const raw = tag.raw.trim()
  if (raw.includes('::')) {
    return raw.split('::').map((s) => s.trim()).slice(1)
  }
  if (tag.args.trim()) {
    return tag.args.trim().split(/\s+/)
  }
  return []
}

export function isSupportedCstMacroTag(tag: ParsedMacroTag): boolean {
  if (tag.isComment) return true
  if (tag.isClose || tag.isElse) return false
  return isKnownMacroToken(tag.raw)
}

export function invokeCstMacro(
  tag: ParsedMacroTag,
  ctx: PromptMacroContext,
  renderNested: (snippet: string) => string,
): string {
  if (tag.isComment) return ''

  if (!isSupportedCstMacroTag(tag)) {
    return unsupportedMacroPlaceholder(tag.raw)
  }

  const name = tag.name
  let args = macroTagArgs(tag).map((arg) =>
    arg.includes('{{') ? renderNested(arg) : arg,
  )

  if (name === 'user') return resolveUserName(ctx)
  if (name === 'char') {
    if (args.length === 0) return resolveCharName(ctx, 1)
    const n = Number.parseInt(args[0]!, 10)
    return resolveCharName(ctx, n)
  }
  if (/^char\d+$/.test(name)) {
    const n = Number.parseInt(name.slice(4), 10)
    return resolveCharName(ctx, n)
  }
  if (name === 'model') return resolveModel(ctx)
  if (name === 'maxprompt' || name === 'context') return resolveContextLength(ctx)
  if (name === 'maxresponsetokens') return resolveMaxResponseTokens(ctx)
  if (name === 'input') return resolveInput(ctx)
  if (name === 'lastgenerationtype') return resolveLastGenerationType(ctx)

  if (name === 'date') return formatDatetimeParts(ctx).date
  if (name === 'time') {
    if (args.length === 0) return formatDatetimeParts(ctx).time
    return formatTimeWithUtcOffset(ctx, args[0]!)
  }
  if (name === 'datetime') return formatDatetimeParts(ctx).datetime
  if (name === 'weekday') return formatDatetimeParts(ctx).weekday
  if (name === 'isodate') return formatDatetimeParts(ctx).isodate
  if (name === 'isotime') return formatDatetimeParts(ctx).isotime
  if (name === 'datetimeformat') {
    return formatDatetimePattern(ctx, args[0] ?? 'YYYY-MM-DD HH:mm:ss')
  }
  if (name === 'idleduration') return resolveIdleDuration(ctx)
  if (name === 'timediff') {
    return resolveTimeDiff(ctx, args[0] ?? '', args[1] ?? '')
  }

  if (name === 'newline') return repeatChar('\n', args[0])
  if (name === 'space') return repeatChar(' ', args[0])
  if (name === 'noop') return ''
  if (name === 'trim') return (args[0] ?? '').trim()
  if (name === 'reverse') return [...(args[0] ?? '')].reverse().join('')
  if (name === 'random') return pickRandomArg(args)
  if (name === 'roll') return rollDiceSpec(args[0] ?? '1d6')

  if (name === 'authorsnote') return resolveAuthorsNote(ctx)
  if (name === 'defaultauthorsnote') return resolveDefaultAuthorsNote(ctx)
  if (name === 'lastmessage') return resolveLastMessage(ctx)
  if (name === 'lastusermessage') return resolveLastUserMessage(ctx)
  if (name === 'lastcharmessage') return resolveLastCharMessage(ctx)
  if (name === 'lastmessageid') return resolveLastMessageId(ctx)
  if (name === 'firstincludedmessageid') return resolveFirstIncludedMessageId(ctx)
  if (name === 'allchatrange') return resolveAllChatRange(ctx)
  if (name === 'lastswipeid') return resolveLastSwipeId(ctx)
  if (name === 'currentswipeid') return resolveCurrentSwipeId(ctx)
  if (name === 'notchar') return resolveNotChar(ctx)
  if (name === 'hasextension') return resolveHasExtension(ctx, args[0] ?? '')

  if (name === 'pick') {
    return stablePickFromArgs(ctx.conversationId ?? '', args)
  }

  if (name === 'description') {
    return resolvePrimaryField(ctx, (f) => f.description)
  }
  if (name === 'personality') {
    return resolvePrimaryField(ctx, (f) => f.personality)
  }
  if (name === 'scenario') return resolvePrimaryField(ctx, (f) => f.scenario)
  if (name === 'persona') return resolvePersona(ctx)
  if (name === 'mesexamples' || name === 'mesexamplesraw') {
    return resolvePrimaryField(ctx, (f) => f.mesExample)
  }
  if (name === 'charprompt') {
    return resolvePrimaryField(ctx, (f) => f.systemPrompt)
  }
  if (name === 'charinstruction') {
    return resolvePrimaryField(ctx, (f) => f.postHistoryInstructions)
  }
  if (name === 'charcreatornotes') {
    return resolvePrimaryField(ctx, (f) => f.creatorNotes)
  }
  if (name === 'charversion') {
    return resolvePrimaryField(ctx, (f) => f.characterVersion)
  }
  if (name === 'chardepthprompt') {
    return resolvePrimaryField(ctx, (f) => f.depthPrompt)
  }
  if (name === 'charfirstmessage') {
    return resolveCharFirstMessage(ctx.primaryCharacter, args[0])
  }

  if (name === 'getvar') {
    return getLocalVar(ctx, args[0] ?? '')
  }
  if (name === 'setvar') {
    const varName = args[0] ?? ''
    const value = args.slice(1).join('::')
    if (varName) setLocalVar(ctx, varName, value)
    return ''
  }
  if (name === 'hasvar') {
    return resolveHasVarMacro(ctx, args[0] ?? '')
  }
  if (name === 'getglobalvar') {
    return getGlobalVar(ctx, args[0] ?? '')
  }
  if (name === 'setglobalvar') {
    const varName = args[0] ?? ''
    const value = args.slice(1).join('::')
    if (varName) setGlobalVar(ctx, varName, value)
    return ''
  }
  if (name === 'hasglobalvar') {
    return resolveHasGlobalVarMacro(ctx, args[0] ?? '')
  }

  const head = normalizeMacroHead(name)
  if (COLON_MACRO_HEADS.has(head) && args.length === 0) {
    return unsupportedMacroPlaceholder(tag.raw)
  }

  return unsupportedMacroPlaceholder(tag.raw)
}

/** scoped `{{setvar name}}` … `{{/setvar}}` 等块体求值后执行 */
export function invokeCstScopedMacro(
  tag: ParsedMacroTag,
  bodyText: string,
  ctx: PromptMacroContext,
): string {
  const trimmed = trimScopedBlockContent(bodyText)
  const name = tag.name
  const varName = tag.args.trim().split(/\s+/)[0] ?? ''

  if (name === 'setvar') {
    if (varName) setLocalVar(ctx, varName, trimmed)
    return ''
  }
  if (name === 'setglobalvar') {
    if (varName) setGlobalVar(ctx, varName, trimmed)
    return ''
  }
  if (name === 'reverse') {
    return [...trimmed].reverse().join('')
  }
  if (name === 'trim') {
    return trimmed.trim()
  }
  return unsupportedMacroPlaceholder(tag.raw)
}
