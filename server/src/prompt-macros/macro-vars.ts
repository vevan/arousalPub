import {
  clampMacroVarValue,
  MACRO_VAR_MAX_KEYS,
  sanitizeMacroVarMap,
} from './macro-var-limits.js'
import {
  markMacroGlobalVarTouched,
  markMacroLocalVarTouched,
} from './macro-var-touched.js'
import type { PromptMacroContext } from './types.js'

export type MacroVarMap = Record<string, string>

export function cloneMacroVarMap(src?: MacroVarMap | null): MacroVarMap {
  return sanitizeMacroVarMap(src)
}

export function normalizeVarName(raw: string): string {
  return raw.trim()
}

export function getLocalVar(ctx: PromptMacroContext, name: string): string {
  const key = normalizeVarName(name)
  if (!key) return ''
  return ctx.macroLocalVars?.[key] ?? ''
}

export function setLocalVar(ctx: PromptMacroContext, name: string, value: string): void {
  const key = normalizeVarName(name)
  if (!key) return
  if (!ctx.macroLocalVars) ctx.macroLocalVars = {}
  if (
    !Object.prototype.hasOwnProperty.call(ctx.macroLocalVars, key) &&
    Object.keys(ctx.macroLocalVars).length >= MACRO_VAR_MAX_KEYS
  ) {
    return
  }
  ctx.macroLocalVars[key] = clampMacroVarValue(value)
  ctx.macroVarsDirty = true
  markMacroLocalVarTouched(ctx, key)
}

export function appendLocalVar(
  ctx: PromptMacroContext,
  name: string,
  chunk: string,
): void {
  const key = normalizeVarName(name)
  if (!key) return
  const prev = getLocalVar(ctx, key)
  setLocalVar(ctx, key, prev + chunk)
}

export function appendGlobalVar(
  ctx: PromptMacroContext,
  name: string,
  chunk: string,
): void {
  const key = normalizeVarName(name)
  if (!key) return
  const prev = getGlobalVar(ctx, key)
  setGlobalVar(ctx, key, prev + chunk)
}

function parseVarNumber(raw: string): number | null {
  const n = Number.parseFloat(raw.trim())
  return Number.isFinite(n) ? n : null
}

export function incrementLocalVar(ctx: PromptMacroContext, name: string): string {
  const key = normalizeVarName(name)
  if (!key) return '1'
  const prev = getLocalVar(ctx, key)
  const n = parseVarNumber(prev)
  const next = n === null ? '1' : String(n + 1)
  setLocalVar(ctx, key, next)
  return next
}

export function decrementLocalVar(ctx: PromptMacroContext, name: string): string {
  const key = normalizeVarName(name)
  if (!key) return '-1'
  const prev = getLocalVar(ctx, key)
  const n = parseVarNumber(prev)
  const next = n === null ? '-1' : String(n - 1)
  setLocalVar(ctx, key, next)
  return next
}

export function incrementGlobalVar(ctx: PromptMacroContext, name: string): string {
  const key = normalizeVarName(name)
  if (!key) return '1'
  const prev = getGlobalVar(ctx, key)
  const n = parseVarNumber(prev)
  const next = n === null ? '1' : String(n + 1)
  setGlobalVar(ctx, key, next)
  return next
}

export function decrementGlobalVar(ctx: PromptMacroContext, name: string): string {
  const key = normalizeVarName(name)
  if (!key) return '-1'
  const prev = getGlobalVar(ctx, key)
  const n = parseVarNumber(prev)
  const next = n === null ? '-1' : String(n - 1)
  setGlobalVar(ctx, key, next)
  return next
}

export function hasLocalVar(ctx: PromptMacroContext, name: string): boolean {
  const key = normalizeVarName(name)
  if (!key) return false
  return Object.prototype.hasOwnProperty.call(ctx.macroLocalVars ?? {}, key)
}

export function getGlobalVar(ctx: PromptMacroContext, name: string): string {
  const key = normalizeVarName(name)
  if (!key) return ''
  return ctx.macroGlobalVars?.[key] ?? ''
}

export function setGlobalVar(ctx: PromptMacroContext, name: string, value: string): void {
  const key = normalizeVarName(name)
  if (!key) return
  if (!ctx.macroGlobalVars) ctx.macroGlobalVars = {}
  if (
    !Object.prototype.hasOwnProperty.call(ctx.macroGlobalVars, key) &&
    Object.keys(ctx.macroGlobalVars).length >= MACRO_VAR_MAX_KEYS
  ) {
    return
  }
  ctx.macroGlobalVars[key] = clampMacroVarValue(value)
  ctx.macroGlobalVarsDirty = true
  markMacroGlobalVarTouched(ctx, key)
}

export function hasGlobalVar(ctx: PromptMacroContext, name: string): boolean {
  const key = normalizeVarName(name)
  if (!key) return false
  return Object.prototype.hasOwnProperty.call(ctx.macroGlobalVars ?? {}, key)
}

export function resolveHasVarMacro(
  ctx: PromptMacroContext,
  name: string,
): string {
  return hasLocalVar(ctx, name) ? 'true' : 'false'
}

export function resolveHasGlobalVarMacro(
  ctx: PromptMacroContext,
  name: string,
): string {
  return hasGlobalVar(ctx, name) ? 'true' : 'false'
}
