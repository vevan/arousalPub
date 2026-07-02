import type { MacroCharacterFields } from './character-fields.js'
import type { MacroHistoryFields } from './history-macros.js'
import { cloneMacroVarMap } from './macro-vars.js'
import type { PromptMacroContext } from './types.js'

const DEFAULT_USER_LABEL = '用户'
const DEFAULT_CHAR_LABEL = '角色'

export interface MacroContextCharacterInput {
  name?: string
  macroFields?: MacroCharacterFields
}

export function buildPromptMacroContext(params: {
  conversationUserName?: string | null
  characters?: MacroContextCharacterInput[]
  userCharacter?: MacroContextCharacterInput | null
  model?: string | null
  contextLength?: number | null
  maxResponseTokens?: number | null
  userInput?: string | null
  promptTrigger?: string | null
  primaryCharacter?: MacroCharacterFields | null
  userPersona?: MacroCharacterFields | null
  now?: Date
  locale?: string | null
  authorsNote?: string | null
  defaultAuthorsNote?: string | null
  conversationId?: string | null
  historyFields?: MacroHistoryFields | null
  enabledPluginIds?: string[] | null
  macroLocalVars?: Record<string, string> | null
  macroGlobalVars?: Record<string, string> | null
  group?: string | null
  groupNotMuted?: string | null
}): PromptMacroContext {
  const raw = params.conversationUserName
  const userName =
    typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_USER_LABEL
  const characters = params.characters ?? []
  const characterNames = characters.map((c, i) => {
    const n = c.name?.trim()
    if (n) return n
    return `${DEFAULT_CHAR_LABEL}${i + 1}`
  })
  const model =
    typeof params.model === 'string' && params.model.trim()
      ? params.model.trim()
      : undefined
  const contextLength =
    typeof params.contextLength === 'number' &&
    !Number.isNaN(params.contextLength) &&
    params.contextLength > 0
      ? params.contextLength
      : undefined
  const maxResponseTokens =
    typeof params.maxResponseTokens === 'number' &&
    !Number.isNaN(params.maxResponseTokens) &&
    params.maxResponseTokens > 0
      ? Math.floor(params.maxResponseTokens)
      : undefined
  const userInput =
    typeof params.userInput === 'string' ? params.userInput : undefined
  const triggerRaw = params.promptTrigger
  const lastGenerationType =
    typeof triggerRaw === 'string' && triggerRaw.trim()
      ? triggerRaw.trim()
      : undefined
  const locale =
    typeof params.locale === 'string' && params.locale.trim()
      ? params.locale.trim()
      : 'en'
  const authorsNoteRaw = params.authorsNote
  const authorsNote =
    typeof authorsNoteRaw === 'string' && authorsNoteRaw.trim()
      ? authorsNoteRaw
      : undefined
  const defaultAuthorsNoteRaw = params.defaultAuthorsNote
  const defaultAuthorsNote =
    typeof defaultAuthorsNoteRaw === 'string' && defaultAuthorsNoteRaw.trim()
      ? defaultAuthorsNoteRaw
      : undefined
  const primaryCharacter =
    params.primaryCharacter ?? characters[0]?.macroFields ?? undefined
  const userPersona =
    params.userPersona ?? params.userCharacter?.macroFields ?? undefined
  const conversationId =
    typeof params.conversationId === 'string' && params.conversationId.trim()
      ? params.conversationId.trim()
      : undefined
  const hf = params.historyFields ?? undefined
  const enabledPluginIds =
    Array.isArray(params.enabledPluginIds) && params.enabledPluginIds.length > 0
      ? params.enabledPluginIds
      : undefined
  return {
    userName,
    characterNames,
    model,
    contextLength,
    maxResponseTokens,
    userInput,
    lastGenerationType,
    primaryCharacter,
    userPersona,
    now: params.now ?? new Date(),
    locale,
    authorsNote,
    defaultAuthorsNote,
    conversationId,
    enabledPluginIds,
    lastMessage: hf?.lastMessage,
    lastUserMessage: hf?.lastUserMessage,
    lastCharMessage: hf?.lastCharMessage,
    lastMessageId: hf?.lastMessageId,
    firstIncludedMessageId: hf?.firstIncludedMessageId,
    allChatRange: hf?.allChatRange,
    lastSwipeId: hf?.lastSwipeId,
    currentSwipeId: hf?.currentSwipeId,
    notChar: hf?.notChar,
    idleReferenceUserAt: hf?.idleReferenceUserAt,
    macroLocalVars: cloneMacroVarMap(params.macroLocalVars),
    macroGlobalVars: cloneMacroVarMap(params.macroGlobalVars),
    ...(typeof params.group === 'string' ? { group: params.group } : {}),
    ...(typeof params.groupNotMuted === 'string'
      ? { groupNotMuted: params.groupNotMuted }
      : {}),
  }
}

export function patchPromptMacroHistoryFields(
  ctx: PromptMacroContext,
  fields: MacroHistoryFields,
): PromptMacroContext {
  return {
    ...ctx,
    lastMessage: fields.lastMessage,
    lastUserMessage: fields.lastUserMessage,
    lastCharMessage: fields.lastCharMessage,
    lastMessageId: fields.lastMessageId,
    firstIncludedMessageId: fields.firstIncludedMessageId,
    allChatRange: fields.allChatRange,
    lastSwipeId: fields.lastSwipeId,
    currentSwipeId: fields.currentSwipeId,
    notChar: fields.notChar,
    idleReferenceUserAt: fields.idleReferenceUserAt,
  }
}
