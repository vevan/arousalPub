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
  /** 仅对 toTurn 的 assistant 正文剥除指定块标签（如末轮补生成） */
  stripBlockTagsOnToTurn?: string[]
  /** 与 stripBlockTagsOnToTurn 联用：仅剥 toTurn 的指定 segment（缺省 = activeSegmentIndex） */
  stripBlockTagsOnToTurnSegmentIndex?: number
}

export type ConversationTranscriptTailBlockSpec = {
  source: 'conversation.transcript.tail'
  blockId: string
  tailCount: number
  regexRuleIds?: string[]
  regexApplyAllTurns?: boolean
  tailOrdinal?: number
  /** 仅对 tail 末轮的 assistant 正文剥除指定块标签 */
  stripBlockTagsOnToTurn?: string[]
  /** 与 stripBlockTagsOnToTurn 联用：仅剥末轮指定 segment（缺省 = activeSegmentIndex） */
  stripBlockTagsOnToTurnSegmentIndex?: number
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

/** 步骤 1 已 resolve 的结果；传入 `completeWithContext` 可跳过重复读盘 */
export type PreparedPluginContextBlocks = {
  blocks: Record<string, string>
  entriesByBlock: Record<string, LorebookEntrySlice[]>
  meta: PluginContextBlocksSuccess['meta']
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

/** completeWithContext 出站后解析提示；除 kind 外字段由插件自述，宿主原样透传 */
export type CompleteWithContextDraftParse = {
  kind: string
} & Record<string, unknown>

export type CompleteWithContextRequest = {
  conversationId: string
  /** 与 `preparedContext` 二选一；有 `preparedContext` 时可省略（避免重复 resolve） */
  blocks: ContextBlockSpec[]
  layout: PromptLayout
  pluginSettings?: Record<string, unknown>
  anchorToTurn: number
  apiConfigId?: string
  responseFormat?: 'json_object' | 'text'
  dryRun?: boolean
  /** 步骤 1 已 resolve 的 blocks；传入后跳过 `runPluginContextBlocksResolve` */
  preparedContext?: PreparedPluginContextBlocks
  /** 出站成功后由插件 hook 解析为 draft */
  draft?: CompleteWithContextDraftParse
  /** 会话 auditDebug 开启且宿主确认后生效；客户端传 true 仍由 index.auditDebug 门控 */
  captureDebug?: boolean
  /** 未绑 apiConfigId 时回退全局 activePresetId；默认 true，显式 false 关闭 */
  fallbackToGlobalDefault?: boolean
}

export type CompleteWithContextDebugCapture = {
  messages: PromptLayoutMessage[]
  upstreamPayload?: unknown
  upstreamStatus?: number
  upstreamRawBody?: string
  assistantContent?: string
}

export type CompleteWithContextSuccess = {
  ok: true
  content?: string
  usage?: { promptTokens?: number; completionTokens?: number }
  latencyMs?: number
  messages: PromptLayoutMessage[]
  /** 插件 hook 解析结果；宿主不解释字段语义 */
  draft?: Record<string, unknown>
  preflight?: AssemblePluginPromptSuccess['preflight']
  debug?: CompleteWithContextDebugCapture
}

export type CompleteWithContextResult =
  | CompleteWithContextSuccess
  | {
      ok: false
      code: string
      detail?: string
      promptTokens?: number
      budget?: number
      messages?: PromptLayoutMessage[]
      debug?: CompleteWithContextDebugCapture
    }
