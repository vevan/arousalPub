/** DOC/39 · 插件二次 LLM 上下文块 catalog（shared 契约） */

export const CONTEXT_BLOCK_SOURCES = [
  'conversation.transcript',
  'conversation.transcript.tail',
  'lorebook.entries',
] as const

export type ContextBlockSource = (typeof CONTEXT_BLOCK_SOURCES)[number]

export type LorebookEntrySlice = {
  id: string
  title: string
  content: string
}

export type LorebookEntriesBlockSpec = {
  source: 'lorebook.entries'
  blockId: string
  lorebookId: string
  entryIds: string[]
  order?: 'as-listed' | 'lorebook-file'
  format?: 'plain' | 'title-content-lines'
}

export type ConversationTranscriptBlockSpec = {
  source: 'conversation.transcript'
  blockId: string
  fromTurn: number
  toTurn: number
  regexRuleIds?: string[]
  regexApplyAllTurns?: boolean
  tailOrdinal?: number
}

export type ConversationTranscriptTailBlockSpec = {
  source: 'conversation.transcript.tail'
  blockId: string
  tailCount: number
  regexRuleIds?: string[]
  regexApplyAllTurns?: boolean
  tailOrdinal?: number
}

export type ContextBlockSpec =
  | LorebookEntriesBlockSpec
  | ConversationTranscriptBlockSpec
  | ConversationTranscriptTailBlockSpec

export type PluginContextBlocksRequest = {
  conversationId: string
  blocks: ContextBlockSpec[]
}

export type PluginContextBlocksSuccess = {
  ok: true
  blocks: Record<string, string>
  entriesByBlock: Record<string, LorebookEntrySlice[]>
  meta: {
    userDisplayName: string
    assistantDisplayName: string
    turnCount?: number
  }
}

export type PluginContextBlocksResult =
  | PluginContextBlocksSuccess
  | { ok: false; code: string }

export type PromptLayoutMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export type PromptLayout = {
  messages: PromptLayoutMessage[]
}

export type AssemblePluginPromptRequest = {
  conversationId: string
  blocks: Record<string, string>
  layout: PromptLayout
  pluginSettings?: Record<string, unknown>
  /** 显式传入；宿主不设默认（DOC/39 D3） */
  anchorToTurn: number
  apiConfigId?: string
  /** dry run：拼 messages + 可选 preflight，不出站 */
  dryRun?: boolean
}

export type AssemblePluginPromptSuccess = {
  ok: true
  messages: PromptLayoutMessage[]
  preflight?: {
    ok: boolean
    promptTokens: number
    budget: number
    code?: string
  }
}

export type AssemblePluginPromptResult =
  | AssemblePluginPromptSuccess
  | { ok: false; code: string; promptTokens?: number; budget?: number }

export type CompleteWithContextDraftParse = {
  kind: 'memory' | 'sidecar'
  fromTurn?: number
  toTurn?: number
  blockTurns?: number
  sidecarName?: string
}

export type CompleteWithContextRequest = {
  conversationId: string
  blocks: ContextBlockSpec[]
  layout: PromptLayout
  pluginSettings?: Record<string, unknown>
  anchorToTurn: number
  apiConfigId?: string
  responseFormat?: 'json_object' | 'text'
  dryRun?: boolean
  /** 出站成功后由插件 hook 解析为 draft */
  draft?: CompleteWithContextDraftParse
}

export type CompleteWithContextSuccess = {
  ok: true
  content?: string
  usage?: { promptTokens?: number; completionTokens?: number }
  latencyMs?: number
  messages: PromptLayoutMessage[]
  draft?: { title: string; content: string; keywords: string[] }
  preflight?: AssemblePluginPromptSuccess['preflight']
}

export type CompleteWithContextResult =
  | CompleteWithContextSuccess
  | { ok: false; code: string; detail?: string; promptTokens?: number; budget?: number }
