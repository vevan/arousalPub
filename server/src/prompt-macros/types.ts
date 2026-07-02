import type { MacroCharacterFields } from './character-fields.js'
import type { MacroVarMap } from './macro-vars.js'

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
  /** BCP 47，默认 en（与 ST moment 缺省一致；未传 locale 时） */
  locale: string
  /** 宏 `{{authorsNote}}`：已启用作者注正文，否则空串 */
  authorsNote?: string
  /** 宏 `{{defaultAuthorsNote}}`：全局默认模板正文 */
  defaultAuthorsNote?: string
  /** Phase B：会话 id（稳定 pick） */
  conversationId?: string
  /** Phase B：历史 / swipe 宏字段 */
  lastMessage?: string
  lastUserMessage?: string
  lastCharMessage?: string
  lastMessageId?: string
  firstIncludedMessageId?: string
  allChatRange?: string
  lastSwipeId?: string
  currentSwipeId?: string
  notChar?: string
  /** ST 群聊：绑定角色名列表 */
  group?: string
  /** ST 群聊：未 mute 的角色名列表 */
  groupNotMuted?: string
  /** ST idleDuration 参照的上一条用户消息 createdAt */
  idleReferenceUserAt?: string
  /** 已启用插件 id（小写比较 hasExtension） */
  enabledPluginIds?: string[]
  /** Phase C：会话局部变量（`{{getvar}}` / `{{setvar}}`） */
  macroLocalVars?: MacroVarMap
  /** Phase C：用户全局变量 */
  macroGlobalVars?: MacroVarMap
  /** 本轮渲染写回过会话局部变量 */
  macroVarsDirty?: boolean
  /** 本轮渲染写回过全局变量 */
  macroGlobalVarsDirty?: boolean
  /** 本轮变更过的会话变量键（并发写盘时 merge） */
  macroLocalVarTouched?: Set<string>
  /** 本轮变更过的全局变量键（并发写盘时 merge） */
  macroGlobalVarTouched?: Set<string>
}
