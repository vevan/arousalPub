export type GroupKind =
  | 'normal'
  | 'character'
  | 'world'
  | 'history'
  | 'userInput'

export type PromptRole = 'system' | 'user' | 'assistant'
export type InjectionPosition = 'relative' | 'chat'
export type PromptTrigger =
  | 'normal'
  | 'continue'
  | 'swipe'
  | 'regenerate'
  | 'groupContinue'

export type PromptBindingSlot =
  | 'boundMain'
  | 'boundWorldBefore'
  | 'boundWorldAfter'
  | 'boundUserPersona'
  | 'boundCharSystemPrompt'
  | 'boundCharDescription'
  | 'boundCharPersonality'
  | 'boundScenario'
  | 'boundEnhanceDefinitions'
  | 'boundDialogueExamples'
  | 'boundChatHistory'
  | 'boundCharacterPostHistory'
  | 'boundUserInput'
  | 'boundMemory'
  | 'boundKnowledge'

export interface PromptGroup {
  id: string
  name: string
  kind: GroupKind
  order: number
  /** 备注，仅编辑页展示 */
  description?: string
  /** false = 组装时跳过组内无 bindingSlot 的自定义条目；绑定槽与 kind 内置注入仍保留 */
  enabled?: boolean
}

export interface PromptEntry {
  id: string
  groupId: string
  title: string
  content: string
  description: string
  tags: string[]
  enabled: boolean
  role: PromptRole
  injectionPosition: InjectionPosition
  injectionDepth: number
  injectionOrder: number
  triggers: PromptTrigger[]
  order: number
  isSeed?: boolean
  bindingSlot?: PromptBindingSlot
  createdAt: string
  updatedAt: string
}

export interface PromptPreset {
  id: string
  name: string
  groups: PromptGroup[]
  prompts: PromptEntry[]
  createdAt: string
  updatedAt: string
}
