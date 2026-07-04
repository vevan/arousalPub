import type { ComposerRef, useChatSession } from '@/composables/useChatSession'
import type { ChatTurnItem } from '@/types/chat-turn'
import type {
  RegexApplyContext,
  RegexPhase,
  RegexRuleSummary,
} from '@/types/regex-rules'
import type { ConversationBatchContext } from '@/plugins/conversation-host'
import type { ConversationChatRequestPlugins } from '@/utils/chat-api'

export type ChatSession = ReturnType<typeof useChatSession>

export interface PluginSlotContext {
  turn?: ChatTurnItem
  listIndex?: number
}

export interface PluginSlotMenuItemDef {
  id: string
  labelKey: string | ((ctx: PluginSlotContext) => string)
  icon?: string | ((ctx: PluginSlotContext) => string)
  filled?: boolean | ((ctx: PluginSlotContext) => boolean)
  when?: (ctx: PluginSlotContext) => boolean
  disabled?: (ctx: PluginSlotContext) => boolean
  onClick: (ctx: PluginSlotContext) => void
}

export interface PluginSlotButtonDef {
  id: string
  /** 宿主注入：注册该按钮的插件 id，用于按 registry order 排序 */
  pluginId?: string
  /** 同 slot、同插件内顺序；未设时按 `registerSlotButton` 注册先后 */
  order?: number
  icon: string | ((ctx: PluginSlotContext) => string)
  tooltipKey: string | ((ctx: PluginSlotContext) => string)
  filled?: boolean | ((ctx: PluginSlotContext) => boolean)
  /** 追加到宿主 `.plugin-slot` 的 class（空格分隔）；插件样式建议带插件前缀并通过 `registerStyles` 注入 */
  class?: string | ((ctx: PluginSlotContext) => string)
  /** `v-icon` 字号（px）；默认 13 */
  iconSize?: number | ((ctx: PluginSlotContext) => number)
  when?: (ctx: PluginSlotContext) => boolean
  disabled?: (ctx: PluginSlotContext) => boolean
  /** 平铺按钮；与 menu 二选一 */
  onClick?: (ctx: PluginSlotContext) => void
  /** 悬停或点击展开子菜单 */
  menu?: PluginSlotMenuItemDef[]
  /** 默认 hover+click 均可展开 */
  menuOpenOn?: 'hover' | 'click' | 'both'
}

export interface AssistantReplyCompleteEvent {
  mode: 'send' | 'regenerate'
  traceId?: string
}

/** 服务端落盘成功（SSE arousal.persist 或等价 JSON） */
export interface AssistantReplyPersistedEvent {
  mode: 'send' | 'regenerate'
  traceId?: string
  turnOrdinal?: number
  receiveId?: string
  isFirstTurn?: boolean
}

export interface PluginFormFieldOption {
  value: string
  labelKey?: string
  /** 直接展示文案（优先于 labelKey） */
  label?: string
  /** checkboxGroup：为 true 时不可取消勾选 */
  locked?: boolean
}

export interface PluginFormFieldDef {
  key: string
  labelKey: string
  type?: 'text' | 'textarea' | 'integer' | 'radio' | 'apiPreset' | 'lorebook' | 'checkboxGroup'
  options?: PluginFormFieldOption[]
  visibleWhen?: { field: string; equals: unknown }
  hintKey?: string
  /** 为 true 时字段只读展示 */
  readOnly?: boolean
}

export interface PluginFormDialogDef {
  titleKey: string
  bodyKey?: string
  fields: PluginFormFieldDef[]
  /** 双模式（send / regenerate / revise），与 submitKey 二选一 */
  submitKeys?: { send: string; regenerate: string; revise?: string }
  /** 单按钮对话框（如导出） */
  submitKey?: string
  cancelKey?: string
  /** 可选第三按钮（如预览「跳过」） */
  skipKey?: string
  /** 禁止点击遮罩或 Esc 关闭（避免误触中断） */
  persistent?: boolean
  canSubmit: (model: Record<string, unknown>) => boolean
  onSubmit: (
    host: PluginWebHost,
    model: Record<string, unknown>,
  ) => void | Promise<void>
  onCancel?: (
    host: PluginWebHost,
    model: Record<string, unknown>,
  ) => void | Promise<void>
  onSkip?: (
    host: PluginWebHost,
    model: Record<string, unknown>,
  ) => void | Promise<void>
  /** 可选第四按钮（如预览「重新生成」） */
  regenerateKey?: string
  /** 为 false 时不展示 regenerate 按钮（如 debug 门控） */
  regenerateVisible?: (host: PluginWebHost) => boolean
  /** 与 canSubmit 类似，控制 regenerate 是否可点 */
  regenerateCanSubmit?: (model: Record<string, unknown>) => boolean
  onRegenerate?: (
    host: PluginWebHost,
    model: Record<string, unknown>,
  ) => void | Promise<void>
}

export interface PluginConfirmOptions {
  title: string
  body: string
  confirmLabel?: string
  cancelLabel?: string
  confirmColor?: string
}

export interface PluginToastOptions {
  color?: string
  timeout?: number
}

export interface PluginNotifyOptions extends PluginToastOptions {
  /** reserved for persistent notifications */
  persistent?: boolean
}

export interface PluginProgressOptions {
  message?: string
  phase?: string
  done: number
  total: number
  /** 等待阶段使用不确定进度动画 */
  indeterminate?: boolean
  /** 显示「强制中断」并中止进行中的插件 API 请求 */
  abortable?: boolean
  abortLabel?: string
}

export interface ConversationMeta {
  conversationId: string
  title: string
  userDisplayName: string
  assistantDisplayName: string
  exportedAt: string
  characterIds: string[]
  userCharacterId: string | null
}

export interface ConversationScopeOptions {
  /** 默认 true；false 时只读且不占写锁 */
  writeLock?: boolean
  /** 默认 true；loading / 再生中拒绝进入 scope */
  requireIdle?: boolean
}

export type LorebookTriggerMode = 'keyword' | 'constant' | 'vector'

export interface LorebookSummaryDto {
  id: string
  name: string
  updatedAt: string
}

export interface LorebookGroupDto {
  id: string
  name: string
  order: number
  description?: string
}

export interface LorebookEntryDto {
  id: string
  groupId: string
  title: string
  content: string
  comment?: string
  enabled: boolean
  order: number
  keys: string[]
  constant: boolean
  triggerMode?: LorebookTriggerMode
  priority: number
  createdAt: string
  updatedAt: string
}

export interface LorebookDto {
  id: string
  name: string
  description?: string
  groups: LorebookGroupDto[]
  entries: LorebookEntryDto[]
  createdAt: string
  updatedAt: string
}

export interface LorebookEntryCreateBody {
  groupId?: string
  title: string
  content: string
  keys?: string[]
  comment?: string
  enabled?: boolean
  constant?: boolean
  triggerMode?: LorebookTriggerMode
  priority?: number
  order?: number
}

export interface LorebookEntryPatchBody {
  title?: string
  content?: string
  keys?: string[]
  comment?: string
  enabled?: boolean
  constant?: boolean
  triggerMode?: LorebookTriggerMode
  priority?: number
  order?: number
  groupId?: string
}

export interface PluginCompleteRequest {
  /** 省略时由宿主按对话 apiPreset.plugins → 插件设置解析 */
  apiConfigId?: string
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
  modelOverride?: string
  stream?: boolean
  responseFormat?: 'json_object' | 'text'
}

export interface PluginCompleteResponse {
  ok: true
  content: string
  usage?: { promptTokens?: number; completionTokens?: number }
  latencyMs?: number
}

export interface PluginPrepareContextRequest {
  fromTurn: number
  toTurn: number
  targetLorebookId: string
  includePreviousMemories?: boolean
  previousMemoriesLimit?: number
  previousSummariesLimit?: number
  sidecarEntryIds?: Record<string, string>
  sidecarIds?: string[]
  regexRuleIds?: string[]
  tailOrdinal?: number
  regexApplyAllTurns?: boolean
}

export interface PluginPrepareContextResponse {
  ok: true
  /** 参考上下文（previous-summaries / sidecars / context-history），拼入 system */
  systemReferenceContext: string
  /** 待摘要 `<history>`，作为 user 消息 */
  userContent: string
  transcript: string
  turnCount: number
  meta: {
    userDisplayName: string
    assistantDisplayName: string
  }
}

export interface LorebookNormalizeEntryRefsRequest {
  lorebookId: string
  entryIds: Record<string, string>
  validKeys: string[]
}

export interface LorebookApplyOrderRequest {
  scope?: 'full' | 'partial'
  groupIds?: string[]
  entriesByGroup?: Record<string, string[]>
}

export interface LorebookApplyOrderResult {
  ok: true
  lorebook: LorebookDto
  changed: number
  savedAt: string
}

export interface LorebookEnsureRequest {
  nameTemplate?: string
}

export interface LorebookEnsureResult {
  id: string
  name: string
  created: boolean
}

export interface PluginCompleteDraftRequest {
  /** 省略时由宿主解析（对话覆盖 → 插件设置） */
  apiConfigId?: string
  kind: 'memory' | 'sidecar'
  /** 参考上下文，与 systemPromptTemplate 拼成 system 消息 */
  systemReferenceContext?: string
  userContent: string
  systemPromptTemplate: string
  fromTurn?: number
  toTurn?: number
  blockTurns?: number
  sidecarName?: string
}

export interface PluginCompleteDraftResponse {
  ok: true
  draft: { title: string; content: string; keywords: string[] }
  usage?: { promptTokens?: number; completionTokens?: number }
  latencyMs?: number
}

export interface PluginCompletePreflightResult {
  ok: boolean
  promptTokens: number
  budget: number
  contextLength: number | null
  outputReserve: number
  model: string | null
  encoding: string
  code?: string
}

export type { PluginHostApiError } from '@/plugins/plugin-host-api-error'
export { isPluginHostApiError } from '@/plugins/plugin-host-api-error'

/** `sendWithPlugins` / `regenerateWithPlugins`：成功为 undefined，失败为可展示文案（用户中止不返回） */
export type PluginChatSendError = string | undefined

export interface PluginWebHost {
  registerSlotButton(slot: string, def: PluginSlotButtonDef): void
  registerFormDialog(
    pluginId: string,
    def: PluginFormDialogDef,
    dialogId?: string,
  ): void
  openFormDialog(
    pluginId: string,
    model: Record<string, unknown>,
    dialogId?: string,
    opts?: PluginFormDialogOpenOpts,
  ): void
  composer: ComposerRef
  session: ChatSession
  t: (key: string, params?: Record<string, unknown>) => string
  /** 解析插件命名空间键：`plugins.{pluginId}.{key}` */
  pluginKey: (key: string) => string
  turn: {
    isLastUserTurn: (turn: ChatTurnItem) => boolean
    isTurnAwaitingAssistant: (turn: ChatTurnItem) => boolean
  }
  chat: {
    sendWithPlugins: (
      userText: string,
      plugins: ConversationChatRequestPlugins,
    ) => Promise<PluginChatSendError>
    regenerateWithPlugins: (
      listIndex: number,
      userText: string,
      plugins: ConversationChatRequestPlugins,
    ) => Promise<PluginChatSendError>
  }
  lifecycle: {
    onAssistantReplyComplete: (
      handler: (event: AssistantReplyCompleteEvent) => void,
    ) => () => void
    onAssistantReplyPersisted: (
      handler: (event: AssistantReplyPersistedEvent) => void,
    ) => () => void
    /** swipe / 轮次数据变更（宿主 Vue 响应式触发，插件 bundle 勿用自带 watch） */
    onTurnDataChanged: (handler: () => void) => () => void
    /** `loading` / `regeneratingTurnOrdinal` 变化（发消息、再生开始/结束） */
    onGeneratingChanged: (handler: () => void) => () => void
  }
  conversation: {
    getId(): string
    getMeta(): Promise<ConversationMeta>
    runScope(
      opts: ConversationScopeOptions,
      fn: (ctx: ConversationBatchContext) => Promise<void>,
    ): Promise<void>
    /** `runScope({ writeLock: true, requireIdle: true }, fn)` 的别名 */
    runBatch(fn: (ctx: ConversationBatchContext) => Promise<void>): Promise<void>
    refresh(): Promise<void>
    getPluginSettings(): Promise<Record<string, unknown>>
    /** 当前会话插件设置的同步快照（来自宿主 store） */
    getPluginSettingsSnapshot(): Record<string, unknown>
    /** 会话 pluginSettings 变更时回调（含 Tab 与 footer 等写入） */
    onPluginSettingsChanged(
      handler: (settings: Record<string, unknown>) => void,
    ): () => void
    patchPluginSettings(
      partial: Record<string, unknown>,
    ): Promise<Record<string, unknown>>
    /** 摘要预览等插件流程占用对话：禁止发送新消息 */
    setPluginHold(hold: boolean): void
  }
  lorebook: {
    list(): Promise<LorebookSummaryDto[]>
    get(id: string): Promise<LorebookDto>
    createEntry(
      lorebookId: string,
      body: LorebookEntryCreateBody,
    ): Promise<LorebookEntryDto>
    createEntriesBatch(
      lorebookId: string,
      entries: LorebookEntryCreateBody[],
    ): Promise<LorebookEntryDto[]>
    patchEntry(
      lorebookId: string,
      entryId: string,
      body: LorebookEntryPatchBody,
    ): Promise<LorebookEntryDto>
    normalizeEntryRefs(
      req: LorebookNormalizeEntryRefsRequest,
    ): Promise<Record<string, string>>
    applyOrder(
      lorebookId: string,
      req: LorebookApplyOrderRequest,
    ): Promise<LorebookApplyOrderResult>
    ensure(req?: LorebookEnsureRequest): Promise<LorebookEnsureResult>
  }
  regex: {
    listRules(opts?: { phases?: RegexPhase[] }): Promise<RegexRuleSummary[]>
    applyText(
      text: string,
      ruleIds: string[] | 'all',
      ctx: RegexApplyContext,
    ): Promise<string>
    applyMessages(
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
      ruleIds: string[] | 'all',
      ctx: {
        phase: RegexPhase
        tailOrdinal: number
        turnOrdinalByIndex?: (
          index: number,
          msg: { role: 'system' | 'user' | 'assistant'; content: string },
        ) => number | undefined
      },
    ): Promise<{ role: 'system' | 'user' | 'assistant'; content: string }[]>
  }
  api: {
    listPresets(): Promise<{ id: string; alias: string }[]>
  }
  plugin: {
    complete(req: PluginCompleteRequest): Promise<PluginCompleteResponse>
    prepareContext(
      req: PluginPrepareContextRequest,
    ): Promise<PluginPrepareContextResponse>
    completeDraft(
      req: PluginCompleteDraftRequest,
    ): Promise<PluginCompleteDraftResponse>
  }
  token: {
    preflightComplete(req: {
      apiConfigId?: string
      messages: { role: 'system' | 'user' | 'assistant'; content: string }[]
    }): Promise<PluginCompletePreflightResult>
  }
  plugins: {
    getUserSettings(): Promise<Record<string, unknown>>
    /** 已加载则同步读；未加载返回 `{}`（scoped host） */
    getUserSettingsSnapshot(): Record<string, unknown>
    /** 设置 → 插件 保存全局 settings 后回调（仅 scoped host） */
    onUserSettingsChanged?(
      handler: (settings: Record<string, unknown>) => void,
    ): () => void
  }
  macros: {
    /** 按当前会话上下文展开 `{{user}}` `{{char}}` 等与主对话一致的宏 */
    expand(
      text: string,
      opts?: { apiConfigId?: string; toTurn?: number; persistVars?: boolean },
    ): Promise<string>
  }
  render: {
    richMessageToHtml(text: string): string
    reasoningToHtml(text: string): string
  }
  ui: {
    toast(message: string, opts?: PluginToastOptions): void
    notify(title: string, body?: string, opts?: PluginNotifyOptions): void
    confirm(opts: PluginConfirmOptions): Promise<boolean>
    openFormDialog(
      pluginId: string,
      model: Record<string, unknown>,
      dialogId?: string,
      opts?: PluginFormDialogOpenOpts,
    ): void
    progress(opts: PluginProgressOptions): void
    clearProgress(): void
    panel: {
      register(opts: {
        placement: 'leftRail' | 'rightRail'
        pluginId: string
        tabIcon: string
        tabLabelKey: string
        interactive?: boolean
        routes?: ('home' | 'chat')[]
      }): void
      setHtml(
        placement: 'leftRail' | 'rightRail',
        pluginId: string,
        html: string,
        opts?: { revision?: number },
      ): void
      open(placement: 'leftRail' | 'rightRail', pluginId?: string): void
      setHidden(placement: 'leftRail' | 'rightRail', hidden: boolean): void
      onEvent(
        placement: 'leftRail' | 'rightRail',
        pluginId: string,
        handlers: {
          onInput?: (e: { field: string; value: string; type: string }) => void
          onAction?: (e: { action: string; target: HTMLElement }) => void
        },
      ): void
    }
  }
  /** 插件切换 slot 按钮外观后调用，触发 UI 刷新 */
  refreshSlotButtons: () => void
  /**
   * 注入本插件 CSS（写入 `<style data-plugin-styles="{pluginId}">`，同 id 重复调用为覆盖更新）。
   * 仅在 `createScopedPluginHost` 作用域内可用。
   */
  registerStyles(css: string): void
}

export interface PluginWebModule {
  register?: (host: PluginWebHost) => void
}

export interface PluginRegistryPublicEntry {
  id: string
  name: string
  version: string
  order: number
  slots: string[]
  webEntry: string | null
}

export interface PluginFormDialogOpenOpts {
  /** 传给 `titleKey` 的 i18n 插值参数 */
  titleParams?: Record<string, unknown>
}

export interface OpenPluginFormState {
  pluginId: string
  dialogId?: string
  model: Record<string, unknown>
  titleParams?: Record<string, unknown>
}
