import type { PromptMacroContext } from './types.js'

export function markMacroLocalVarTouched(
  ctx: PromptMacroContext,
  key: string,
): void {
  const k = key.trim()
  if (!k) return
  if (!ctx.macroLocalVarTouched) ctx.macroLocalVarTouched = new Set()
  ctx.macroLocalVarTouched.add(k)
}

export function markMacroGlobalVarTouched(
  ctx: PromptMacroContext,
  key: string,
): void {
  const k = key.trim()
  if (!k) return
  if (!ctx.macroGlobalVarTouched) ctx.macroGlobalVarTouched = new Set()
  ctx.macroGlobalVarTouched.add(k)
}
