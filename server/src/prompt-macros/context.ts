import type { PromptMacroContext } from './types.js'

const DEFAULT_USER_LABEL = '用户'
const DEFAULT_CHAR_LABEL = '角色'

export function buildPromptMacroContext(params: {
  conversationUserName?: string | null
  characters?: { name?: string }[]
  model?: string | null
  contextLength?: number | null
  now?: Date
  locale?: string | null
}): PromptMacroContext {
  const raw = params.conversationUserName
  const userName =
    typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_USER_LABEL
  const characterNames = (params.characters ?? []).map((c, i) => {
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
  const locale =
    typeof params.locale === 'string' && params.locale.trim()
      ? params.locale.trim()
      : 'zh-CN'
  return {
    userName,
    characterNames,
    model,
    contextLength,
    now: params.now ?? new Date(),
    locale,
  }
}
