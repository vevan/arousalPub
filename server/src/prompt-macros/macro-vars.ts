import { isStTruthy } from './macro-truthy.js'
import type { PromptMacroContext } from './types.js'

export type MacroVarMap = Record<string, string>

export function cloneMacroVarMap(src?: MacroVarMap | null): MacroVarMap {
  if (!src || typeof src !== 'object') return {}
  const out: MacroVarMap = {}
  for (const [k, v] of Object.entries(src)) {
    if (typeof k === 'string' && k.trim() && typeof v === 'string') {
      out[k.trim()] = v
    }
  }
  return out
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
  ctx.macroLocalVars[key] = value
  ctx.macroVarsDirty = true
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
  ctx.macroGlobalVars[key] = value
  ctx.macroGlobalVarsDirty = true
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
