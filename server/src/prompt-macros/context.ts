import type { MacroCharacterFields } from './character-fields.js'
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
      : 'zh-CN'
  const authorsNoteRaw = params.authorsNote
  const authorsNote =
    typeof authorsNoteRaw === 'string' && authorsNoteRaw.trim()
      ? authorsNoteRaw
      : undefined
  const primaryCharacter =
    params.primaryCharacter ?? characters[0]?.macroFields ?? undefined
  const userPersona =
    params.userPersona ?? params.userCharacter?.macroFields ?? undefined
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
  }
}
