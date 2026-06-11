import Handlebars from 'handlebars'
import {
  formatDatetimeParts,
  resolveAuthorsNote,
  resolveCharName,
  resolveContextLength,
  resolveModel,
  resolveUserName,
} from './macro-values.js'
import { preprocessLegacyMacroSyntax } from './preprocess.js'
import { replaceUnsupportedMacroPlaceholders } from './unsupported.js'
import type { PromptMacroContext } from './types.js'

const COMPILE_CACHE_MAX = 512
const compileCache = new Map<string, Handlebars.TemplateDelegate>()

const handlebars = Handlebars.create()

function macroContext(options: Handlebars.HelperOptions): PromptMacroContext {
  return options.data.root as PromptMacroContext
}

handlebars.registerHelper('user', function (...args: unknown[]) {
  const options = args[args.length - 1] as Handlebars.HelperOptions
  return resolveUserName(macroContext(options))
})

handlebars.registerHelper('char', function (...args: unknown[]) {
  const options = args[args.length - 1] as Handlebars.HelperOptions
  const ctx = macroContext(options)
  if (args.length === 1) {
    return resolveCharName(ctx, 1)
  }
  const n = Number.parseInt(String(args[0]), 10)
  return resolveCharName(ctx, n)
})

handlebars.registerHelper('model', function (...args: unknown[]) {
  const options = args[args.length - 1] as Handlebars.HelperOptions
  return resolveModel(macroContext(options))
})

handlebars.registerHelper('maxprompt', function (...args: unknown[]) {
  const options = args[args.length - 1] as Handlebars.HelperOptions
  return resolveContextLength(macroContext(options))
})

handlebars.registerHelper('context', function (...args: unknown[]) {
  const options = args[args.length - 1] as Handlebars.HelperOptions
  return resolveContextLength(macroContext(options))
})

handlebars.registerHelper('date', function (...args: unknown[]) {
  const options = args[args.length - 1] as Handlebars.HelperOptions
  return formatDatetimeParts(macroContext(options)).date
})

handlebars.registerHelper('time', function (...args: unknown[]) {
  const options = args[args.length - 1] as Handlebars.HelperOptions
  return formatDatetimeParts(macroContext(options)).time
})

handlebars.registerHelper('datetime', function (...args: unknown[]) {
  const options = args[args.length - 1] as Handlebars.HelperOptions
  return formatDatetimeParts(macroContext(options)).datetime
})

handlebars.registerHelper('newline', () => '\n')

handlebars.registerHelper('authorsnote', function (...args: unknown[]) {
  const options = args[args.length - 1] as Handlebars.HelperOptions
  return resolveAuthorsNote(macroContext(options))
})
/** camelCase 别名 */
handlebars.registerHelper('authorsNote', function (...args: unknown[]) {
  const options = args[args.length - 1] as Handlebars.HelperOptions
  return resolveAuthorsNote(macroContext(options))
})

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
  const withoutUnsupported = replaceUnsupportedMacroPlaceholders(text)
  const normalized = preprocessLegacyMacroSyntax(withoutUnsupported)
  if (!normalized.includes('{{')) return normalized
  try {
    return compileCached(normalized)(ctx, { data: { root: ctx } })
  } catch {
    return normalized
  }
}
