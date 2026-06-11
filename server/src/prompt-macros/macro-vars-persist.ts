import {
  readConversationIndex,
  writeConversationIndex,
} from '../chat-storage.js'
import { cloneMacroVarMap, type MacroVarMap } from './macro-vars.js'
import { readGlobalMacroGlobalVars, updateGlobalMacroGlobalVars } from '../user-preferences-file.js'
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

export async function persistMacroVarMutations(
  ctx: PromptMacroContext,
): Promise<void> {
  const convId = ctx.conversationId?.trim()
  if (ctx.macroVarsDirty && convId) {
    const idx = await readConversationIndex(convId)
    if (idx) {
      idx.macroLocalVars = cloneMacroVarMap(ctx.macroLocalVars)
      await writeConversationIndex(convId, idx)
    }
    ctx.macroVarsDirty = false
  }
  if (ctx.macroGlobalVarsDirty) {
    await updateGlobalMacroGlobalVars(cloneMacroVarMap(ctx.macroGlobalVars))
    ctx.macroGlobalVarsDirty = false
  }
}
