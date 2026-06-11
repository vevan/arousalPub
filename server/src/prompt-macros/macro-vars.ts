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
