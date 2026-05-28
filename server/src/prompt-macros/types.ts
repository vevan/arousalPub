/** 宏展开上下文（仅服务端构造） */

export interface PromptMacroContext {
  userName: string
  /** 下标 0 → {{char}} / {{char1}} */
  characterNames: string[]
  model?: string
  contextLength?: number
  /** 用于 {{date}} {{time}} {{datetime}} */
  now: Date
  /** BCP 47，默认 zh-CN */
  locale: string
}

export type MacroHandler = (text: string, ctx: PromptMacroContext) => string
