import {
  patchConversationMacroLocalVars,
  readConversationIndex,
} from '../chat-storage.js'
import { sanitizeMacroVarMap } from './macro-var-limits.js'
import { cloneMacroVarMap, type MacroVarMap } from './macro-vars.js'
import {
  readGlobalMacroGlobalVars,
  updateGlobalMacroGlobalVars,
} from '../user-preferences-file.js'
import type { PromptMacroContext } from './types.js'

export async function loadMacroGlobalVarsForContext(): Promise<MacroVarMap> {
  return cloneMacroVarMap(await readGlobalMacroGlobalVars())
}

export async function loadMacroLocalVarsForConversation(
  conversationId: string,
): Promise<MacroVarMap> {
  const idx = await readConversationIndex(conversationId)
  return cloneMacroVarMap(idx?.macroLocalVars)
}

/** 将本轮 touched 键合并进磁盘 snapshot，避免并发请求整表覆盖 */
export function mergeMacroVarMapsForPersist(
  disk: MacroVarMap,
  ctxMap: MacroVarMap | undefined,
  touched: Set<string> | undefined,
): MacroVarMap {
  const merged = cloneMacroVarMap(disk)
  if (touched && touched.size > 0) {
    for (const key of touched) {
      const value = ctxMap?.[key]
      if (value !== undefined) merged[key] = value
    }
    return sanitizeMacroVarMap(merged)
  }
  return sanitizeMacroVarMap({ ...merged, ...cloneMacroVarMap(ctxMap) })
}

export async function persistMacroVarMutations(
  ctx: PromptMacroContext,
): Promise<void> {
  const convId = ctx.conversationId?.trim()
  if (ctx.macroVarsDirty && convId) {
    const ok = await patchConversationMacroLocalVars(convId, (disk) =>
      mergeMacroVarMapsForPersist(
        disk,
        ctx.macroLocalVars,
        ctx.macroLocalVarTouched,
      ),
    )
    if (ok) {
      ctx.macroVarsDirty = false
      ctx.macroLocalVarTouched = undefined
    }
  }
  if (ctx.macroGlobalVarsDirty) {
    const disk = await readGlobalMacroGlobalVars()
    await updateGlobalMacroGlobalVars(
      mergeMacroVarMapsForPersist(
        disk,
        ctx.macroGlobalVars,
        ctx.macroGlobalVarTouched,
      ),
    )
    ctx.macroGlobalVarsDirty = false
    ctx.macroGlobalVarTouched = undefined
  }
}
