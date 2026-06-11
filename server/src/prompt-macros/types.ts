import type { MacroCharacterFields } from './character-fields.js'

/** 宏展开上下文（仅服务端构造） */

export interface PromptMacroContext {
  userName: string
  /** 下标 0 → {{char}} / {{char1}} */
  characterNames: string[]
  model?: string
  contextLength?: number
  maxResponseTokens?: number
  /** 组装时用户输入（{{input}}） */
  userInput?: string
  /** 组装触发：normal / continue / swipe / regenerate（{{lastGenerationType}}） */
  lastGenerationType?: string
  /** 首绑角色卡字段（{{description}} 等） */
  primaryCharacter?: MacroCharacterFields
  /** 用户 persona 卡字段（{{persona}}） */
  userPersona?: MacroCharacterFields
  /** 用于 {{date}} {{time}} {{datetime}} */
  now: Date
  /** BCP 47，默认 zh-CN */
  locale: string
  /** 宏 `{{authorsNote}}`：已启用作者注正文，否则空串 */
  authorsNote?: string
  /** 宏 `{{defaultAuthorsNote}}`：全局默认模板正文 */
  defaultAuthorsNote?: string
}
