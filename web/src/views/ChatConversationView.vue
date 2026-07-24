<script setup lang="ts">
import ConversationContextSettings from '@/components/ConversationContextSettings.vue'
import ChatBranchPanel from '@/components/chat/ChatBranchPanel.vue'
import ChatBranchLabelDialog from '@/components/chat/ChatBranchLabelDialog.vue'
import ChatGroupChatDialog from '@/components/chat/ChatGroupChatDialog.vue'
import ChatComposerGroupRoster from '@/components/chat/ChatComposerGroupRoster.vue'
import HomeChat from '@/components/HomeChat.vue'
import {
  CHAT_CONVERSATION_ACTIONS_KEY,
} from '@/composables/chat-conversation-actions'
import { CONVERSATION_BRANCH_KEY } from '@/composables/conversation-branch-context'
import { useConversationBranches } from '@/composables/useConversationBranches'
import { useMemoryRebuild } from '@/composables/useMemoryRebuild'
import { bootstrapAppData } from '@/bootstrap/app-data'
import { coreNotify } from '@/utils/core-notify'
import { fetchDefaultLorebookIds, fetchLorebookPickerItems } from '@/utils/default-lorebook'
import { useConnectionStore } from '@/stores/connection'
import { usePreferencesStore } from '@/stores/preferences'
import { usePromptsStore } from '@/stores/prompts'
import { useUiContextStore } from '@/stores/ui-context'
import {
  hasHistorySettingsOverride,
  normalizeHistorySettings,
  resolveHistorySettings,
  type HistorySettings,
} from '@/utils/history-settings'
import {
  hasMemorySettingsOverride,
  normalizeMemorySettings,
  resolveMemorySettings,
  type MemorySettings,
} from '@/utils/memory-settings'
import {
  hasKnowledgeSettingsOverride,
  normalizeKnowledgeSettings,
  resolveKnowledgeSettings,
  type KnowledgeSettings,
} from '@/utils/knowledge-settings'
import {
  hasBudgetTrimSettingsOverride,
  normalizeBudgetTrimSettings,
  resolveBudgetTrimSettings,
  type BudgetTrimSettings,
} from '@/utils/budget-trim-settings'
import {
  hasLorebookSettingsOverride,
  normalizeLorebookSettings,
  resolveLorebookSettings,
  type LorebookSettings,
} from '@/utils/lorebook-settings'
import {
  authorsNoteComposerActive,
  authorsNoteFromIndex,
  normalizeAuthorsNote,
  type AuthorsNoteSettings,
} from '@/utils/authors-note-settings'
import {
  hasConversationChatOverride,
  hasConversationEmbeddingOverride,
  readConversationEmbeddingOverride,
  resolveConversationChatDisplay,
  resolveConversationEmbeddingModelSettings,
  type ConversationEmbeddingApiSettingsOverride,
  type ResolvedConversationChatDisplay,
} from '@/utils/conversation-api-settings'
import {
  formatHybridFtsSpec,
  hybridFtsSpecsMatch,
  normalizeHybridFtsSettings,
} from '@/utils/hybrid-fts-settings'
import {
  groupChatWithEnsuredMemberColors,
  memberColorsIncomplete,
  normalizeGroupChatSettings,
  type GroupChatSettings,
} from '@/utils/group-chat-settings'
import { onConversationIndexPatched } from '@/utils/conversation-index-sync'
import { fileLibraryContentUrl } from '@/utils/authenticated-media-url'
import { useAuthStore } from '@/stores/auth'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onScopeDispose, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const props = defineProps<{
  conversationId: string
}>()

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()
const conn = useConnectionStore()
const prefStore = usePreferencesStore()
const promptsStore = usePromptsStore()
const uiContext = useUiContextStore()
const { activePresetId: globalPromptPresetId, indexEntries: promptIndexEntries } =
  storeToRefs(promptsStore)
const {
  lorebookRecursiveEnabled,
  lorebookMaxRecursionDepth,
  lorebookKeywordTopK,
  lorebookVectorEnabled,
  lorebookVectorTopK,
  historyLimitEnabled,
  historyMaxTurns,
  memoryEnabled,
  memoryTopK,
  knowledgeEnabled,
  knowledgeTopK,
  knowledgeChunkSizeChars,
  knowledgeChunkOverlapChars,
  budgetTrimSettings,
  embeddingModel,
  embeddingDimensions,
  hybridFtsProfile,
  hybridFtsDictVariant,
} = storeToRefs(prefStore)

const globalHybridFtsSettings = computed(() =>
  normalizeHybridFtsSettings({
    profile: hybridFtsProfile.value,
    dictVariant: hybridFtsDictVariant.value,
  }),
)
const globalHybridFtsSpec = computed(() => formatHybridFtsSpec(globalHybridFtsSettings.value))

const loading = ref(true)
const errorText = ref('')
const title = ref('')
const titleSaving = ref(false)
const lorebookNameById = ref<Record<string, string>>({})
const convContextSettingsRef = ref<InstanceType<
  typeof ConversationContextSettings
> | null>(null)
const homeChatRef = ref<InstanceType<typeof HomeChat> | null>(null)
/** Settings dialog teleports; pass HomeChat.pluginHost down for companion ensurePluginById */
const chatPluginHost = computed(() => homeChatRef.value?.pluginHost ?? null)
const hasConversationTurns = ref(false)

const {
  activeBranchPath,
  branchPanelOpen,
  branchBusy,
  branchTreeLoading,
  branchTreeNodes,
  branchLoadError,
  branchSuccessMessage,
  branchActionError,
  branchHighlightForkTurnId,
  branchRegistryBroken,
  forkTurnIdsWithSiblings,
  activeBranchDisplayLabel,
  syncActiveFromIndex,
  refreshBranchTree,
  repairBranchRegistry,
  switchActiveBranch,
  createBranchDialogOpen,
  pendingCreateTurn,
  requestCreateBranchFromTurn,
  confirmCreateBranch,
  cancelCreateBranch,
  renameBranch,
  deleteBranch,
  openBranchPanel,
  clearBranchHighlight,
  isForkTurn,
} = useConversationBranches({
  getConversationId: () => props.conversationId,
  onActivePathChanged: async () => {
    await homeChatRef.value?.reloadTurns()
  },
})

provide(CONVERSATION_BRANCH_KEY, {
  activeBranchPath,
  forkTurnIdsWithSiblings,
  branchPanelOpen,
  branchBusy,
  openBranchPanel,
  requestCreateBranchFromTurn,
  isForkTurn,
})

const createBranchSubtitle = computed(() => {
  const n = pendingCreateTurn.value?.turnOrdinal
  if (n == null || n < 1) return undefined
  return t('chat.branches.createBranchForkFrom', { n })
})

watch(branchSuccessMessage, (msg) => {
  const text = msg.trim()
  if (!text) return
  coreNotify(text, undefined, { level: 'success', timeout: 3000 })
  branchSuccessMessage.value = ''
})

watch(branchActionError, (msg) => {
  const text = msg.trim()
  if (!text) return
  coreNotify(text, undefined, { level: 'error', timeout: 4000 })
  branchActionError.value = ''
})

watch(branchPanelOpen, (open) => {
  if (!open) clearBranchHighlight()
})

const conversationMemoryEmbeddingModel = ref<string | null>(null)
const conversationMemoryEmbeddingDimensions = ref<number | null>(null)
const conversationMemoryHybridFtsSpec = ref<string | null>(null)
const memoryRebuildDialogOpen = ref(false)
let memoryRebuildDismissKey = ''

const {
  loading: memoryRebuildLoading,
  error: memoryRebuildError,
  done: memoryRebuildDone,
  total: memoryRebuildTotal,
  turns: memoryRebuildTurns,
  loreEntries: memoryRebuildLoreEntries,
  stageLabel: memoryRebuildStageLabel,
  percent: memoryRebuildPercent,
  rebuild: rebuildMemoryIndex,
} = useMemoryRebuild(() => props.conversationId)

function memoryRebuildDismissToken(
  storedModel: string | null,
  globalModel: string,
  storedDims: number | null,
  globalDims: number | null,
  storedFtsSpec: string | null,
  globalFtsSpec: string,
): string {
  return `${storedModel ?? ''}|${globalModel}|${storedDims ?? ''}|${globalDims ?? ''}|${storedFtsSpec ?? ''}|${globalFtsSpec}`
}

function embeddingDimsMatch(a: number | null, b: number | null): boolean {
  return (a ?? null) === (b ?? null)
}

function shouldOfferMemoryRebuild(): boolean {
  if (!hasConversationTurns.value) return false
  if (!convBindings.value.memory.effective.memoryEnabled) return false
  const globalModel = embeddingModel.value.trim()
  if (!globalModel) return false
  const globalDims = embeddingDimensions.value
  const effectiveEmbedding = convBindings.value.embeddingApi.effective
  const storedModel = conversationMemoryEmbeddingModel.value
  const storedDims = conversationMemoryEmbeddingDimensions.value
  if (!storedModel) return false
  const embeddingMatches =
    storedModel === effectiveEmbedding.embeddingModel &&
    embeddingDimsMatch(storedDims, effectiveEmbedding.embeddingDimensions)
  const storedFts = conversationMemoryHybridFtsSpec.value
  // 增量索引曾漏写 FTS 戳记：embedding 已对齐且戳记为空时不因 FTS 误报重建
  const ftsMatches = !storedFts?.trim()
    ? embeddingMatches
    : hybridFtsSpecsMatch(storedFts, globalHybridFtsSettings.value)
  if (embeddingMatches && ftsMatches) {
    return false
  }
  const token = memoryRebuildDismissToken(
    storedModel,
    globalModel,
    storedDims,
    globalDims,
    conversationMemoryHybridFtsSpec.value,
    globalHybridFtsSpec.value,
  )
  if (memoryRebuildDismissKey === token) return false
  return true
}

function maybePromptMemoryRebuild(): void {
  if (shouldOfferMemoryRebuild()) {
    memoryRebuildError.value = ''
    memoryRebuildDialogOpen.value = true
  }
}

function openMemoryRebuildDialog(): void {
  memoryRebuildError.value = ''
  memoryRebuildDialogOpen.value = true
}

provide(CHAT_CONVERSATION_ACTIONS_KEY, {
  openMemoryRebuild: openMemoryRebuildDialog,
})

function dismissMemoryRebuild(): void {
  memoryRebuildDismissKey = memoryRebuildDismissToken(
    conversationMemoryEmbeddingModel.value,
    embeddingModel.value.trim(),
    conversationMemoryEmbeddingDimensions.value,
    embeddingDimensions.value,
    conversationMemoryHybridFtsSpec.value,
    globalHybridFtsSpec.value,
  )
  memoryRebuildDialogOpen.value = false
  memoryRebuildError.value = ''
}

async function confirmMemoryRebuild(): Promise<void> {
  const nextModel = await rebuildMemoryIndex()
  if (!nextModel) return
  conversationMemoryEmbeddingModel.value = nextModel
  conversationMemoryHybridFtsSpec.value = globalHybridFtsSpec.value
  memoryRebuildDismissKey = memoryRebuildDismissToken(
    nextModel,
    embeddingModel.value.trim(),
    embeddingDimensions.value,
    embeddingDimensions.value,
    globalHybridFtsSpec.value,
    globalHybridFtsSpec.value,
  )
  memoryRebuildDialogOpen.value = false
}

function onMemoryRebuiltFromSettings(model: string): void {
  conversationMemoryEmbeddingModel.value = model
  conversationMemoryEmbeddingDimensions.value = embeddingDimensions.value
  conversationMemoryHybridFtsSpec.value = globalHybridFtsSpec.value
  memoryRebuildDismissKey = memoryRebuildDismissToken(
    model,
    embeddingModel.value.trim(),
    embeddingDimensions.value,
    embeddingDimensions.value,
    globalHybridFtsSpec.value,
    globalHybridFtsSpec.value,
  )
}

function onRegexAppliedFromSettings(): void {
  void homeChatRef.value?.reloadTurns()
}

interface LorebookContextBinding {
  useGlobal: boolean
  effective: LorebookSettings
}

interface HistoryContextBinding {
  useGlobal: boolean
  effective: HistorySettings
}

interface MemoryContextBinding {
  useGlobal: boolean
  effective: MemorySettings
}

interface BudgetTrimContextBinding {
  useGlobal: boolean
  effective: BudgetTrimSettings
}

interface ApiContextBinding {
  useGlobal: boolean
  effective: ResolvedConversationChatDisplay | null
  apiPresetRaw: unknown
}

interface EmbeddingApiContextBinding {
  useGlobal: boolean
  effective: { embeddingModel: string; embeddingDimensions: number | null }
  override?: ConversationEmbeddingApiSettingsOverride
}

interface KnowledgeContextBinding {
  useGlobal: boolean
  effective: KnowledgeSettings
}

interface ConvContextBindings {
  promptPresetId: string | null
  characterIds: string[]
  characterNames: string[]
  groupChatEnabled: boolean
  groupChat: GroupChatSettings
  lorebookIds: string[]
  knowledgeBaseIds: string[]
  knowledge: KnowledgeContextBinding
  lorebook: LorebookContextBinding
  history: HistoryContextBinding
  memory: MemoryContextBinding
  budgetTrim: BudgetTrimContextBinding
  chatApi: ApiContextBinding
  embeddingApi: EmbeddingApiContextBinding
  /** 会话 `{{user}}`；null 表示未设置 */
  userName: string | null
  /** 用户 persona 卡 id；仅用于 UI 回显头像 */
  userCharacterId: string | null
  /** 对话背景图 fileId */
  backgroundImageFileId: string | null
  /** 对话 BGM fileId */
  bgmFileId: string | null
  authorsNote: AuthorsNoteSettings
}

function globalLoreFromStore(): LorebookSettings {
  return normalizeLorebookSettings({
    recursiveEnabled: prefStore.lorebookRecursiveEnabled,
    maxRecursionDepth: prefStore.lorebookMaxRecursionDepth,
    keywordTopK: prefStore.lorebookKeywordTopK,
    vectorEnabled: prefStore.lorebookVectorEnabled,
    vectorTopK: prefStore.lorebookVectorTopK,
  })
}

function globalHistoryFromStore(): HistorySettings {
  return normalizeHistorySettings({
    limitEnabled: prefStore.historyLimitEnabled,
    maxTurns: prefStore.historyMaxTurns,
  })
}

function globalMemoryFromStore(): MemorySettings {
  return normalizeMemorySettings({
    memoryEnabled: prefStore.memoryEnabled,
    memoryTopK: prefStore.memoryTopK,
    stripPluginBlocks: prefStore.memoryStripPluginBlocks,
    stripBlockTags: prefStore.memoryStripBlockTags,
    recallFuseLastAssistant: prefStore.memoryRecallFuseLastAssistant,
    recallUserWeight: prefStore.memoryRecallUserWeight,
  })
}

function globalBudgetTrimFromStore(): BudgetTrimSettings {
  return normalizeBudgetTrimSettings(budgetTrimSettings.value)
}

function globalKnowledgeFromStore(): KnowledgeSettings {
  return normalizeKnowledgeSettings({
    enabled: knowledgeEnabled.value,
    topK: knowledgeTopK.value,
    chunkSizeChars: knowledgeChunkSizeChars.value,
    chunkOverlapChars: knowledgeChunkOverlapChars.value,
  })
}

function knowledgeContextFromIndex(
  idx: Record<string, unknown>,
): KnowledgeContextBinding {
  const global = globalKnowledgeFromStore()
  const raw = idx.knowledgeSettings
  const override =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Partial<KnowledgeSettings>)
      : undefined
  const useGlobal = !hasKnowledgeSettingsOverride(override)
  return {
    useGlobal,
    effective: resolveKnowledgeSettings(global, override),
  }
}

function memoryContextFromIndex(
  idx: Record<string, unknown>,
): MemoryContextBinding {
  const global = globalMemoryFromStore()
  const raw = idx.memorySettings
  const override =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Partial<MemorySettings>)
      : undefined
  const useGlobal = !hasMemorySettingsOverride(override)
  return {
    useGlobal,
    effective: resolveMemorySettings(global, override),
  }
}

function historyContextFromIndex(
  idx: Record<string, unknown>,
): HistoryContextBinding {
  const global = globalHistoryFromStore()
  const raw = idx.historySettings
  const override =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Partial<HistorySettings>)
      : undefined
  const useGlobal = !hasHistorySettingsOverride(override)
  return {
    useGlobal,
    effective: resolveHistorySettings(global, override),
  }
}

function budgetTrimContextFromIndex(
  idx: Record<string, unknown>,
): BudgetTrimContextBinding {
  const global = globalBudgetTrimFromStore()
  const raw = idx.budgetTrimSettings
  const override =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Partial<BudgetTrimSettings>)
      : undefined
  const useGlobal = !hasBudgetTrimSettingsOverride(override)
  return {
    useGlobal,
    effective: resolveBudgetTrimSettings(global, override),
  }
}

function lorebookContextFromIndex(
  idx: Record<string, unknown>,
): LorebookContextBinding {
  const global = globalLoreFromStore()
  const raw = idx.lorebookSettings
  const override =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Partial<LorebookSettings>)
      : undefined
  const useGlobal = !hasLorebookSettingsOverride(override)
  return {
    useGlobal,
    effective: resolveLorebookSettings(global, override),
  }
}

function clientResolvedCharacterIds(idx: Record<string, unknown>): string[] {
  if (Array.isArray(idx.characterIds)) {
    const seen = new Set<string>()
    const out: string[] = []
    for (const raw of idx.characterIds) {
      if (typeof raw !== 'string') continue
      const id = raw.trim()
      if (!id || seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
    return out
  }
  return []
}

function globalEmbeddingFromStore() {
  return {
    embeddingModel: embeddingModel.value.trim(),
    embeddingDimensions: embeddingDimensions.value,
  }
}

function chatApiContextFromIndex(idx: Record<string, unknown>): ApiContextBinding {
  const apiPresetRaw = idx.apiPreset
  const useGlobal = !hasConversationChatOverride(apiPresetRaw)
  const effective = resolveConversationChatDisplay(
    conn.presets,
    conn.activePresetId,
    apiPresetRaw,
  )
  return { useGlobal, effective, apiPresetRaw }
}

function embeddingApiContextFromIndex(
  idx: Record<string, unknown>,
): EmbeddingApiContextBinding {
  const global = globalEmbeddingFromStore()
  const override = readConversationEmbeddingOverride(idx)
  const useGlobal = !hasConversationEmbeddingOverride(override)
  return {
    useGlobal,
    effective: resolveConversationEmbeddingModelSettings(global, override),
    override,
  }
}

function bindingsFromIndex(idx: Record<string, unknown>): ConvContextBindings {
  const pid = idx.promptPresetId
  const promptPresetId =
    typeof pid === 'string' && pid.trim() ? pid.trim() : null
  const lb = idx.lorebookIds
  const lorebookIds = Array.isArray(lb)
    ? lb.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []
  const kb = idx.knowledgeBaseIds
  const knowledgeBaseIds = Array.isArray(kb)
    ? kb.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []
  const un = idx.userName
  const userName =
    typeof un === 'string' && un.trim() ? un.trim() : null
  const uci = idx.userCharacterId
  const userCharacterId =
    typeof uci === 'string' && uci.trim() ? uci.trim() : null
  const bgImg = idx.backgroundImageFileId
  const backgroundImageFileId =
    typeof bgImg === 'string' && bgImg.trim() ? bgImg.trim().toLowerCase() : null
  const bgm = idx.bgmFileId
  const bgmFileId =
    typeof bgm === 'string' && bgm.trim() ? bgm.trim().toLowerCase() : null
  const cn = idx.characterNames
  const characterNames = Array.isArray(cn)
    ? cn.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : []
  const groupChat = normalizeGroupChatSettings(idx.groupChat)
  const groupChatEnabled = groupChat.enabled === true
  return {
    promptPresetId,
    characterIds: clientResolvedCharacterIds(idx),
    characterNames,
    groupChatEnabled,
    groupChat,
    lorebookIds,
    knowledgeBaseIds,
    knowledge: knowledgeContextFromIndex(idx),
    lorebook: lorebookContextFromIndex(idx),
    history: historyContextFromIndex(idx),
    memory: memoryContextFromIndex(idx),
    budgetTrim: budgetTrimContextFromIndex(idx),
    chatApi: chatApiContextFromIndex(idx),
    embeddingApi: embeddingApiContextFromIndex(idx),
    userName,
    userCharacterId,
    backgroundImageFileId,
    bgmFileId,
    authorsNote: authorsNoteFromIndex(idx),
  }
}

const convBindings = ref<ConvContextBindings>({
  promptPresetId: null,
  characterIds: [],
  characterNames: [],
  groupChatEnabled: false,
  groupChat: normalizeGroupChatSettings(undefined),
  lorebookIds: [],
  knowledgeBaseIds: [],
  knowledge: {
    useGlobal: true,
    effective: normalizeKnowledgeSettings(),
  },
  lorebook: {
    useGlobal: true,
    effective: {
      recursiveEnabled: false,
      maxRecursionDepth: 2,
      keywordTopK: 64,
      vectorEnabled: false,
      vectorTopK: 5,
    },
  },
  history: {
    useGlobal: true,
    effective: { limitEnabled: false, maxTurns: 20 },
  },
  memory: {
    useGlobal: true,
    effective: normalizeMemorySettings(),
  },
  budgetTrim: {
    useGlobal: true,
    effective: normalizeBudgetTrimSettings(),
  },
  chatApi: {
    useGlobal: true,
    effective: null,
    apiPresetRaw: undefined,
  },
  embeddingApi: {
    useGlobal: true,
    effective: { embeddingModel: '', embeddingDimensions: null },
  },
  userName: null,
  userCharacterId: null,
  backgroundImageFileId: null,
  bgmFileId: null,
  authorsNote: normalizeAuthorsNote(),
})

const backgroundImageUrl = computed(() =>
  fileLibraryContentUrl(auth.user?.id, convBindings.value.backgroundImageFileId),
)

const bgmUrl = computed(() =>
  fileLibraryContentUrl(auth.user?.id, convBindings.value.bgmFileId),
)

const bgmMuted = ref(false)
const bgmAudioRef = ref<HTMLAudioElement | null>(null)
/** 递增以丢弃过期的 BGM play/load 异步结果 */
let bgmApplyGen = 0

const chatPaneStyle = computed(() => {
  const url = backgroundImageUrl.value
  if (!url) return undefined
  // JSON.stringify 保证 CSS url() 引号与转义安全（token URL 本身无引号，防御查询串）
  const cssUrl = JSON.stringify(url)
  return {
    backgroundImage: `linear-gradient(rgba(var(--v-theme-surface), 0.72), rgba(var(--v-theme-surface), 0.82)), url(${cssUrl})`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundAttachment: 'local',
  } as Record<string, string>
})

function stopBgmAudio() {
  bgmApplyGen += 1
  const el = bgmAudioRef.value
  if (!el) return
  el.pause()
  el.removeAttribute('src')
  try {
    el.load()
  } catch {
    /* ignore */
  }
}

/** 切会话 / 卸载：立刻清掉上一会话的背景与 BGM，避免串播 */
function clearConversationMediaBindings() {
  stopBgmAudio()
  convBindings.value = {
    ...convBindings.value,
    backgroundImageFileId: null,
    bgmFileId: null,
  }
}

async function applyBgmUrl(url: string | null) {
  const gen = ++bgmApplyGen
  await nextTick()
  if (gen !== bgmApplyGen) return
  const el = bgmAudioRef.value
  if (!el) return
  if (!url) {
    el.pause()
    el.removeAttribute('src')
    try {
      el.load()
    } catch {
      /* ignore */
    }
    return
  }
  if (el.src && el.getAttribute('src') === url) {
    el.loop = true
    el.muted = bgmMuted.value
    return
  }
  el.src = url
  el.loop = true
  el.muted = bgmMuted.value
  try {
    await el.play()
  } catch {
    // 浏览器可能拦截无手势自动播放；用户点静音/取消静音后再播
  }
  // 过期 gen 不再动 el，避免 pause 掉更新的音轨
}

watch(
  () => bgmUrl.value,
  (url) => {
    void applyBgmUrl(url)
  },
)

watch(bgmMuted, (muted) => {
  const el = bgmAudioRef.value
  if (!el) return
  el.muted = muted
  if (!muted && bgmUrl.value) {
    void el.play().catch(() => {})
  }
})

function toggleBgmMuted() {
  bgmMuted.value = !bgmMuted.value
}

const headerChatLabel = computed(() => {
  if (!conn.isApiKeyConfigured) return ''
  if (convBindings.value.chatApi.useGlobal) return ''
  const chat = convBindings.value.chatApi.effective
  if (chat?.alias.trim()) {
    const model = chat.model.trim()
    return model ? `${chat.alias.trim()} · ${model}` : chat.alias.trim()
  }
  return ''
})

const boundLorebooks = computed(() =>
  convBindings.value.lorebookIds.map((id) => ({
    id,
    label: lorebookNameById.value[id] ?? id,
  })),
)

/** 会话显式绑定优先，否则与组装管线一致使用全局激活预设 */
const effectivePromptPresetId = computed(() => {
  const explicit = convBindings.value.promptPresetId
  if (explicit) return explicit
  const global = globalPromptPresetId.value?.trim()
  return global || null
})

const boundPromptLabel = computed(() => {
  const id = effectivePromptPresetId.value
  if (!id) return ''
  const hit = promptIndexEntries.value.find((p) => p.id === id)
  return hit?.name?.trim() || id
})

function openBoundLorebook(lorebookId: string): void {
  uiContext.requestOpenLorebooksDialog(lorebookId)
}

function openBoundPrompt(): void {
  const id = effectivePromptPresetId.value
  if (!id) return
  uiContext.requestOpenPromptsDialog(id)
}

const groupChatDialogOpen = ref(false)

const canOpenGroupChatSettings = computed(
  () => convBindings.value.characterIds.length >= 2,
)

function onGroupChatSettingsSaved(payload: {
  groupChat: GroupChatSettings
  characterIds: string[]
}): void {
  const nameById = new Map(
    convBindings.value.characterIds.map((id, i) => [
      id,
      convBindings.value.characterNames[i]?.trim() || id,
    ]),
  )
  convBindings.value = {
    ...convBindings.value,
    groupChat: payload.groupChat,
    groupChatEnabled: payload.groupChat.enabled === true,
    characterIds: payload.characterIds,
    characterNames: payload.characterIds.map((id) => nameById.get(id) ?? id),
  }
}

function onGroupChatRosterSaved(groupChat: GroupChatSettings): void {
  convBindings.value = {
    ...convBindings.value,
    groupChat,
    groupChatEnabled: groupChat.enabled === true,
  }
}

const showGroupRoster = computed(
  () =>
    convBindings.value.groupChatEnabled &&
    convBindings.value.characterIds.length > 0,
)

const rosterUserInput = computed({
  get: () => {
    const s = homeChatRef.value?.session as { userInput?: string } | undefined
    return typeof s?.userInput === 'string' ? s.userInput : ''
  },
  set: (value: string) => {
    const s = homeChatRef.value?.session as { userInput?: string } | undefined
    if (s) s.userInput = value
  },
})

/** 已开启群聊但成员缺色时写回一次，保证气泡/边框能着色 */
async function persistMissingMemberColorsIfNeeded(
  conversationId: string,
  bindings: ConvContextBindings,
): Promise<void> {
  if (!bindings.groupChatEnabled) return
  if (!memberColorsIncomplete(bindings.characterIds, bindings.groupChat.members)) {
    return
  }
  const groupChat = groupChatWithEnsuredMemberColors(
    bindings.groupChat,
    bindings.characterIds,
  )
  try {
    const res = await fetch(`/api/chat/conversations/${conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ groupChat }),
    })
    if (!res.ok) return
    if (props.conversationId !== conversationId) return
    const j = (await res.json()) as { index?: Record<string, unknown> }
    if (j.index) {
      convBindings.value = bindingsFromIndex(j.index)
    } else {
      convBindings.value = {
        ...convBindings.value,
        groupChat,
        groupChatEnabled: true,
      }
    }
  } catch {
    /* 补色失败不阻断对话加载 */
  }
}

watch(
  () => convBindings.value.lorebookIds,
  (ids) => {
    uiContext.setConversationLorebookIds(ids)
  },
  { immediate: true },
)

watch(
  effectivePromptPresetId,
  (id) => {
    uiContext.setConversationPromptPresetId(id)
  },
  { immediate: true },
)

const authorsNoteActive = computed(() =>
  authorsNoteComposerActive(convBindings.value.authorsNote),
)

function openAuthorsNoteSettings(): void {
  convContextSettingsRef.value?.open('authorsNote')
}

async function loadLorebookNameMap(): Promise<void> {
  const items = await fetchLorebookPickerItems()
  const map: Record<string, string> = {}
  for (const item of items) {
    map[item.id] = item.name
  }
  lorebookNameById.value = map
}

function applyConversationMemoryIndexMeta(index: Record<string, unknown>): void {
  const memModel = index.memoryEmbeddingModel
  conversationMemoryEmbeddingModel.value =
    typeof memModel === 'string' && memModel.trim() ? memModel.trim() : null
  const memDims = index.memoryEmbeddingDimensions
  conversationMemoryEmbeddingDimensions.value =
    typeof memDims === 'number' && Number.isFinite(memDims) && memDims > 0
      ? Math.floor(memDims)
      : null
  const memFts = index.memoryHybridFtsProfile
  conversationMemoryHybridFtsSpec.value =
    typeof memFts === 'string' && memFts.trim() ? memFts.trim() : null
}

function onConvContextPatched(
  index: Record<string, unknown>,
  expectedConversationId?: string,
) {
  if (
    expectedConversationId &&
    expectedConversationId !== props.conversationId
  ) {
    return
  }
  applyConversationMemoryIndexMeta(index)
  convBindings.value = bindingsFromIndex(index)
  maybePromptMemoryRebuild()
}

const stopIndexPatched = onConversationIndexPatched((cid, index) => {
  if (cid !== props.conversationId) return
  onConvContextPatched(index)
})

onScopeDispose(() => {
  stopIndexPatched()
  stopBgmAudio()
})

async function patchAuditDebugToServer(id: string) {
  await fetch(`/api/chat/conversations/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auditDebug: {
        enabled: prefStore.writeChatPromptSnapshot,
        maxStored: prefStore.promptDebugMaxStored,
      },
    }),
  })
}

/** 与服务端 updateConversationAuditDebug 对齐的期望值 */
function desiredAuditDebugFromPrefs(): { enabled: boolean; maxStored: number } {
  const enabled = prefStore.writeChatPromptSnapshot === true
  const maxStored = Math.min(
    200,
    Math.max(1, Math.floor(Number(prefStore.promptDebugMaxStored)) || 10),
  )
  return { enabled, maxStored }
}

function auditDebugFromIndex(
  idx: Record<string, unknown> | null | undefined,
): { enabled: boolean; maxStored: number } | null {
  const raw = idx?.auditDebug
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as { enabled?: unknown; maxStored?: unknown }
  return {
    enabled: o.enabled === true,
    maxStored:
      typeof o.maxStored === 'number' && Number.isFinite(o.maxStored)
        ? Math.min(200, Math.max(0, Math.floor(o.maxStored)))
        : -1,
  }
}

function auditDebugMatchesPrefs(
  current: { enabled: boolean; maxStored: number } | null,
): boolean {
  if (!current || current.maxStored < 0) return false
  const desired = desiredAuditDebugFromPrefs()
  return (
    current.enabled === desired.enabled && current.maxStored === desired.maxStored
  )
}

/** 仅当会话 auditDebug 与全局 Debug 偏好不一致时才 PATCH（打开对话默认不写盘） */
async function syncAuditDebugIfNeeded(
  id: string,
  idx?: Record<string, unknown> | null,
): Promise<void> {
  const current = auditDebugFromIndex(idx ?? null)
  if (auditDebugMatchesPrefs(current)) return
  await patchAuditDebugToServer(id)
}

watch(
  [
    lorebookRecursiveEnabled,
    lorebookMaxRecursionDepth,
    lorebookKeywordTopK,
    lorebookVectorEnabled,
    lorebookVectorTopK,
  ],
  () => {
  if (!convBindings.value.lorebook.useGlobal) return
  const global = globalLoreFromStore()
  convBindings.value = {
    ...convBindings.value,
    lorebook: {
      useGlobal: true,
      effective: global,
    },
  }
})

watch([historyLimitEnabled, historyMaxTurns], () => {
  if (!convBindings.value.history.useGlobal) return
  const global = globalHistoryFromStore()
  convBindings.value = {
    ...convBindings.value,
    history: {
      useGlobal: true,
      effective: global,
    },
  }
})

watch(
  [
    memoryEnabled,
    memoryTopK,
    () => prefStore.memoryStripPluginBlocks,
    () => prefStore.memoryStripBlockTags,
    () => prefStore.memoryRecallFuseLastAssistant,
    () => prefStore.memoryRecallUserWeight,
  ],
  () => {
    if (!convBindings.value.memory.useGlobal) return
    const global = globalMemoryFromStore()
    convBindings.value = {
      ...convBindings.value,
      memory: {
        useGlobal: true,
        effective: global,
      },
    }
  },
)

watch(
  [
    knowledgeEnabled,
    knowledgeTopK,
    knowledgeChunkSizeChars,
    knowledgeChunkOverlapChars,
  ],
  () => {
    if (!convBindings.value.knowledge.useGlobal) return
    const global = globalKnowledgeFromStore()
    convBindings.value = {
      ...convBindings.value,
      knowledge: {
        useGlobal: true,
        effective: global,
      },
    }
  },
)

async function ensureConversation(id: string) {
  loading.value = true
  errorText.value = ''
  try {
    // 与读会话并行；首屏不因偏好/连接初始化阻塞
    const boot = bootstrapAppData()

    let res = await fetch(`/api/chat/conversations/${id}`)
    if (res.status === 404) {
      const created = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: id,
          title: t('chat.newConversation'),
        }),
      })
      if (!created.ok) {
        if (props.conversationId === id) {
          errorText.value = t('chatConversation.loadFailed')
          loading.value = false
        }
        return
      }
      if (props.conversationId !== id) return
      const defaultLorebookIds = await fetchDefaultLorebookIds()
      if (props.conversationId !== id) return
      if (defaultLorebookIds.length > 0) {
        await fetch(`/api/chat/conversations/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lorebookIds: defaultLorebookIds }),
        })
      }
      if (props.conversationId !== id) return
      res = await fetch(`/api/chat/conversations/${id}`)
    }
    if (!res.ok) {
      if (props.conversationId === id) {
        errorText.value = t('chatConversation.loadFailed')
        loading.value = false
      }
      return
    }
    const idx = (await res.json()) as Record<string, unknown>
    // 快速切换会话时丢弃过期响应，避免旧背景/BGM/绑定写回
    if (props.conversationId !== id) return
    title.value = typeof idx.title === 'string' ? idx.title : t('chat.newConversation')
    hasConversationTurns.value =
      typeof idx.headChunkFile === 'string' && idx.headChunkFile.length > 0
    applyConversationMemoryIndexMeta(idx)
    convBindings.value = bindingsFromIndex(idx)
    syncActiveFromIndex(idx)

    // 先对齐 auditDebug，避免首条消息在开关写入前落盘而跳过审计
    try {
      await syncAuditDebugIfNeeded(id, idx)
    } catch {
      /* 审计开关失败不阻断打开对话 */
    }
    if (props.conversationId !== id) return

    // 关键路径结束：挂载 HomeChat → loadMessages；其余靠后
    loading.value = false

    void (async () => {
      try {
        await persistMissingMemberColorsIfNeeded(id, convBindings.value)
        await boot
        if (props.conversationId !== id) return
        if (!promptsStore.loaded) {
          await promptsStore.loadIndexFromServer()
        }
        await loadLorebookNameMap()
        if (props.conversationId !== id) return
        void refreshBranchTree()
        maybePromptMemoryRebuild()
      } catch {
        /* 次要初始化失败不阻断已展示的对话 */
      }
    })()
  } catch {
    if (props.conversationId === id) {
      errorText.value = t('chatConversation.loadFailed')
      loading.value = false
    }
  }
}

async function saveTitle() {
  const id = props.conversationId
  const next = title.value.trim()
  if (!next) {
    title.value = t('chat.newConversation')
    return
  }
  titleSaving.value = true
  try {
    const res = await fetch(`/api/chat/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next }),
    })
    if (res.ok) {
      const j = (await res.json()) as { index?: { title?: string } }
      if (j.index?.title) title.value = j.index.title
    }
  } finally {
    titleSaving.value = false
  }
}

watch(
  () => props.conversationId,
  (id) => {
    memoryRebuildDismissKey = ''
    memoryRebuildDialogOpen.value = false
    branchPanelOpen.value = false
    branchLoadError.value = ''
    clearConversationMediaBindings()
    void ensureConversation(id)
  },
  { immediate: true },
)

/** 仅全局 Debug 偏好变更时同步；进页同步见 ensureConversation 延后任务 */
watch(
  () =>
    [prefStore.writeChatPromptSnapshot, prefStore.promptDebugMaxStored] as const,
  async () => {
    const id = props.conversationId
    if (!id || loading.value) return
    try {
      const res = await fetch(`/api/chat/conversations/${id}`)
      if (!res.ok) return
      const idx = (await res.json()) as Record<string, unknown>
      await syncAuditDebugIfNeeded(id, idx)
    } catch {
      /* 偏好同步失败不阻断聊天 */
    }
  },
)

watch([embeddingModel, embeddingDimensions, hybridFtsProfile, hybridFtsDictVariant], () => {
  if (loading.value) return
  maybePromptMemoryRebuild()
})

watch(
  () => convBindings.value.memory.effective.memoryEnabled,
  () => {
    if (loading.value) return
    maybePromptMemoryRebuild()
  },
)
</script>

<template>
  <div
    class="chat_pane app-page-shell"
    :class="{
      'chat_pane--state': loading || !!errorText,
      'chat_pane--has-bg': !!backgroundImageUrl,
    }"
    :style="chatPaneStyle"
  >
    <audio
      ref="bgmAudioRef"
      class="chat-bgm-audio"
      preload="metadata"
    />
    <div
      v-if="loading"
      class="chat-body chat-body--state pa-4 text-body-2 text-medium-emphasis"
    >
      {{ $t('chatConversation.loading') }}
    </div>
    <div
      v-else-if="errorText"
      class="chat-body chat-body--state pa-4"
    >
      <v-alert type="error" variant="tonal" density="compact">
        {{ errorText }}
      </v-alert>
      <v-btn class="mt-4" variant="text" @click="router.push({ name: 'home' })">
        {{ $t('chatConversation.backHome') }}
      </v-btn>
    </div>
    <template v-else>
      <header
        class="chat-header"
        :class="{ 'chat-header--roster-anchor': showGroupRoster }"
      >
        <v-btn
          icon="mdi-arrow-left"
          variant="text"
          density="comfortable"
          size="small"
          class="chat-header__back"
          :aria-label="$t('chatConversation.backHome')"
          @click="router.push({ name: 'home' })"
        />
        <div class="chat-header__title-wrap">
          <input
            v-model="title"
            type="text"
            class="chat-header__title-input"
            :placeholder="$t('chat.newConversation')"
            :disabled="titleSaving"
            @blur="saveTitle"
            @keydown.enter.prevent="($event.target as HTMLInputElement)?.blur()"
          />
          <v-progress-circular
            v-if="titleSaving"
            indeterminate
            size="14"
            width="2"
            class="chat-header__saving"
          />
          <button
            type="button"
            class="chat-header__pill chat-header__pill--clickable chat-header__pill--branch"
            :title="$t('chat.branches.openPanel')"
            :aria-label="$t('chat.branches.openPanel')"
            :disabled="branchBusy"
            @click="openBranchPanel()"
          >
            <v-icon
              icon="mdi-source-branch"
              size="14"
              class="chat-header__pill-icon"
            />
            <span class="chat-header__pill-label">
              {{ activeBranchDisplayLabel }}
            </span>
          </button>
        </div>
        <div class="chat-header__meta">
          <span
            v-if="!conn.isApiKeyConfigured"
            class="chat-header__pill chat-header__pill--warning"
          >
            <span class="chat-header__dot chat-header__dot--warning" />
            {{ $t('chat.hintConfigureApi') }}
          </span>
          <template v-else>
            <span
              v-if="headerChatLabel"
              class="chat-header__pill"
            >
              {{ headerChatLabel }}
            </span>
            <button
              v-if="boundPromptLabel"
              type="button"
              class="chat-header__pill chat-header__pill--prompt chat-header__pill--clickable"
              :title="boundPromptLabel"
              :aria-label="boundPromptLabel"
              @click="openBoundPrompt"
            >
              <v-icon
                icon="mdi-text-box-outline"
                size="14"
                class="chat-header__pill-icon"
              />
              <span class="chat-header__pill-label">{{ boundPromptLabel }}</span>
            </button>
            <v-menu
              v-if="boundLorebooks.length > 0"
              location="bottom end"
              :open-on-hover="true"
              :close-on-content-click="true"
            >
              <template #activator="{ props: menuProps }">
                <v-btn
                  v-bind="menuProps"
                  icon
                  variant="text"
                  density="comfortable"
                  size="small"
                  class="chat-header__lorebook-btn"
                  :aria-label="$t('chatConversation.boundLorebook')"
                >
                  <v-badge
                    class="chat-header__lorebook-badge"
                    :content="boundLorebooks.length"
                    color="primary"
                    floating
                  >
                    <v-icon
                      icon="mdi-book-open-page-variant-outline"
                      size="20"
                    />
                  </v-badge>
                </v-btn>
              </template>
              <v-list
                density="compact"
                class="chat-header__lorebook-menu"
              >
                <v-list-item
                  v-for="lb in boundLorebooks"
                  :key="lb.id"
                  :title="lb.label"
                  :aria-label="lb.label"
                  @click="openBoundLorebook(lb.id)"
                />
              </v-list>
            </v-menu>
          </template>
          <v-btn
            v-if="canOpenGroupChatSettings"
            icon
            variant="text"
            density="comfortable"
            size="small"
            class="chat-header__group-chat"
            :color="convBindings.groupChatEnabled ? 'primary' : undefined"
            :aria-label="$t('chat.groupChat.settings.openButton')"
            @click="groupChatDialogOpen = true"
          >
            <v-icon icon="mdi-account-group-outline" size="20" />
          </v-btn>
          <v-btn
            v-if="bgmUrl"
            icon
            variant="text"
            density="comfortable"
            size="small"
            class="chat-header__bgm"
            :aria-label="
              bgmMuted
                ? $t('chatConversation.bgmUnmute')
                : $t('chatConversation.bgmMute')
            "
            @click="toggleBgmMuted"
          >
            <v-icon
              :icon="bgmMuted ? 'mdi-volume-off' : 'mdi-music-note'"
              size="20"
            />
          </v-btn>
          <v-btn
            icon="mdi-cog-outline"
            variant="text"
            density="comfortable"
            size="small"
            class="chat-header__settings"
            :aria-label="$t('chat.convSettings.openButton')"
            @click="convContextSettingsRef?.open()"
          />
        </div>
      </header>
      <ChatComposerGroupRoster
        v-if="showGroupRoster"
        :conversation-id="conversationId"
        :character-ids="convBindings.characterIds"
        :character-display-names="convBindings.characterNames"
        :group-chat="convBindings.groupChat"
        :user-input="rosterUserInput"
        @update:user-input="rosterUserInput = $event"
        @group-chat-saved="onGroupChatRosterSaved"
      />
      <HomeChat
        ref="homeChatRef"
        :conversation-id="conversationId"
        :conversation-prompt-preset-id="convBindings.promptPresetId"
        :conversation-character-ids="convBindings.characterIds"
        :conversation-character-display-names="convBindings.characterNames"
        :group-chat-enabled="convBindings.groupChatEnabled"
        :group-chat-settings="convBindings.groupChat"
        :conversation-lorebook-ids="convBindings.lorebookIds"
        :conversation-user-name="convBindings.userName"
        :conversation-user-character-id="convBindings.userCharacterId"
        :authors-note-active="authorsNoteActive"
        @open-authors-note="openAuthorsNoteSettings"
      />
      <ChatBranchPanel
        v-model="branchPanelOpen"
        :nodes="branchTreeNodes"
        :active-branch-path="activeBranchPath"
        :busy="branchBusy"
        :tree-loading="branchTreeLoading"
        :error-text="branchLoadError"
        :highlight-fork-turn-id="branchHighlightForkTurnId"
        :registry-broken="branchRegistryBroken"
        :rename-handler="renameBranch"
        @select="switchActiveBranch"
        @delete="deleteBranch"
        @repair="repairBranchRegistry"
      />
      <ChatBranchLabelDialog
        v-model="createBranchDialogOpen"
        :title="$t('chat.branches.createBranchTitle')"
        :subtitle="createBranchSubtitle"
        :hint="$t('chat.branches.createBranchHint')"
        :confirm-text="$t('chat.branches.createBranchConfirm')"
        :busy="branchBusy"
        :error-text="branchLoadError"
        show-stay-checkbox
        @update:model-value="(open) => { if (!open) cancelCreateBranch() }"
        @confirm="confirmCreateBranch"
      />
      <v-dialog
        v-model="memoryRebuildDialogOpen"
        max-width="32rem"
        persistent
      >
        <v-card>
          <v-card-title class="text-body-1 font-weight-medium">
            {{ $t('chatConversation.memoryRebuildTitle') }}
          </v-card-title>
          <v-card-text>
            <p class="text-body-2 mb-3">
              {{ $t('chatConversation.memoryRebuildBody') }}
            </p>
            <div class="text-body-2 text-medium-emphasis">
              <div v-if="conversationMemoryEmbeddingModel">
                {{ $t('chatConversation.memoryRebuildStoredModel') }}:
                <code>{{ conversationMemoryEmbeddingModel }}</code>
              </div>
              <div v-else>
                {{ $t('chatConversation.memoryRebuildStoredUnknown') }}
              </div>
              <div class="mt-1">
                {{ $t('chatConversation.memoryRebuildCurrentModel') }}:
                <code>{{ embeddingModel }}</code>
                <template v-if="embeddingDimensions != null">
                  · {{ embeddingDimensions }}d
                </template>
              </div>
            </div>
            <v-alert
              v-if="memoryRebuildError"
              type="error"
              variant="tonal"
              density="compact"
              class="mt-3"
            >
              {{ memoryRebuildError }}
            </v-alert>
            <div
              v-if="memoryRebuildLoading"
              class="mt-3"
            >
              <div class="text-body-2 text-medium-emphasis mb-1">
                {{ memoryRebuildStageLabel }} ·
                {{
                  $t('chatConversation.memoryRebuildProgress', {
                    done: memoryRebuildDone,
                    total: memoryRebuildTotal,
                  })
                }}
              </div>
              <div
                v-if="memoryRebuildTotal > 0"
                class="text-caption text-medium-emphasis mb-2"
              >
                {{
                  $t('chatConversation.memoryRebuildProgressDetail', {
                    turns: memoryRebuildTurns,
                    loreEntries: memoryRebuildLoreEntries,
                  })
                }}
              </div>
              <v-progress-linear
                :model-value="memoryRebuildTotal > 0 ? memoryRebuildPercent : undefined"
                :indeterminate="memoryRebuildTotal < 1"
                height="8"
                rounded
                color="primary"
              />
            </div>
          </v-card-text>
          <v-card-actions>
            <v-spacer />
            <v-btn
              variant="text"
              :disabled="memoryRebuildLoading"
              @click="dismissMemoryRebuild"
            >
              {{ $t('chatConversation.memoryRebuildLater') }}
            </v-btn>
            <v-btn
              color="primary"
              variant="flat"
              :loading="memoryRebuildLoading"
              @click="confirmMemoryRebuild"
            >
              {{ $t('chatConversation.memoryRebuildConfirm') }}
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-dialog>
      <ChatGroupChatDialog
        v-model="groupChatDialogOpen"
        :conversation-id="conversationId"
        :character-ids="convBindings.characterIds"
        :character-names="convBindings.characterNames"
        :group-chat="convBindings.groupChat"
        @saved="onGroupChatSettingsSaved"
      />
      <ConversationContextSettings
        ref="convContextSettingsRef"
        :conversation-id="conversationId"
        :plugin-host="chatPluginHost"
        :conversation-title="title"
        :initial-prompt-preset-id="convBindings.promptPresetId"
        :initial-character-ids="convBindings.characterIds"
        :initial-group-chat="convBindings.groupChat"
        :initial-lorebook-ids="convBindings.lorebookIds"
        :initial-knowledge-base-ids="convBindings.knowledgeBaseIds"
        :initial-knowledge-settings-use-global="convBindings.knowledge.useGlobal"
        :global-knowledge-top-k="knowledgeTopK"
        :initial-knowledge-top-k="convBindings.knowledge.effective.topK"
        :initial-lorebook-settings-use-global="convBindings.lorebook.useGlobal"
        :global-lore-recursive-enabled="lorebookRecursiveEnabled"
        :global-lore-max-recursion-depth="lorebookMaxRecursionDepth"
        :global-lore-keyword-top-k="lorebookKeywordTopK"
        :global-lore-vector-enabled="lorebookVectorEnabled"
        :global-lore-vector-top-k="lorebookVectorTopK"
        :initial-lorebook-recursive-enabled="convBindings.lorebook.effective.recursiveEnabled"
        :initial-lorebook-max-recursion-depth="convBindings.lorebook.effective.maxRecursionDepth"
        :initial-lorebook-keyword-top-k="convBindings.lorebook.effective.keywordTopK"
        :initial-lorebook-vector-enabled="convBindings.lorebook.effective.vectorEnabled"
        :initial-lorebook-vector-top-k="convBindings.lorebook.effective.vectorTopK"
        :initial-history-settings-use-global="convBindings.history.useGlobal"
        :global-history-limit-enabled="historyLimitEnabled"
        :global-history-max-turns="historyMaxTurns"
        :initial-history-limit-enabled="convBindings.history.effective.limitEnabled"
        :initial-history-max-turns="convBindings.history.effective.maxTurns"
        :initial-memory-settings-use-global="convBindings.memory.useGlobal"
        :global-memory-enabled="memoryEnabled"
        :global-memory-top-k="memoryTopK"
        :initial-memory-enabled="convBindings.memory.effective.memoryEnabled"
        :initial-memory-top-k="convBindings.memory.effective.memoryTopK"
        :initial-budget-trim-settings-use-global="convBindings.budgetTrim.useGlobal"
        :global-budget-trim-settings="budgetTrimSettings"
        :initial-budget-trim-settings="convBindings.budgetTrim.effective"
        :global-embedding-model="embeddingModel"
        :global-embedding-dimensions="embeddingDimensions"
        :conversation-memory-embedding-model="conversationMemoryEmbeddingModel"
        :conversation-memory-embedding-dimensions="conversationMemoryEmbeddingDimensions"
        :has-conversation-turns="hasConversationTurns"
        :conversation-memory-hybrid-fts-spec="conversationMemoryHybridFtsSpec"
        :global-hybrid-fts-spec="globalHybridFtsSpec"
        :initial-user-name="convBindings.userName"
        :initial-user-character-id="convBindings.userCharacterId"
        :initial-background-image-file-id="convBindings.backgroundImageFileId"
        :initial-bgm-file-id="convBindings.bgmFileId"
        :initial-authors-note="convBindings.authorsNote"
        :initial-api-preset="convBindings.chatApi.apiPresetRaw"
        :initial-chat-api-use-global="convBindings.chatApi.useGlobal"
        :initial-embedding-api-use-global="convBindings.embeddingApi.useGlobal"
        :initial-embedding-api-settings="convBindings.embeddingApi.override"
        @patched="(index, cid) => onConvContextPatched(index, cid)"
        @memory-rebuilt="onMemoryRebuiltFromSettings"
        @regex-applied="onRegexAppliedFromSettings"
      />
    </template>
  </div>
</template>

<style scoped>
.chat_pane {
  display: grid;
  grid-template-rows: auto 1fr;
  grid-template-columns: minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
}

.chat_pane--has-bg {
  background-repeat: no-repeat;
}

.chat-bgm-audio {
  display: none;
}

.chat_pane--state {
  grid-template-rows: 1fr;
}

.chat-body--state {
  min-height: 0;
  overflow: auto;
}

/* ========== Chat Header · Tavern × Linear ========== */
.chat-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 0.25rem 0.75rem;
  border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.06);
  min-width: 0;
}

.chat-header--roster-anchor {
  anchor-name: --chat-header-roster-anchor;
}

.chat-header__back {
  color: rgba(var(--v-theme-on-surface), 0.7) !important;
}

.chat-header__title-wrap {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  align-items: center;
  justify-content: start;
  gap: 0.5rem;
  min-width: 0;
}

.chat-header__title-input {
  width: 8em;
  max-width: 8em;
  min-width: 0;
  box-sizing: border-box;
  background: transparent;
  border: none;
  font-family: var(--font-display);
  font-size: 1.1875rem;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
  letter-spacing: 0.005em;
  padding: 0.25rem 0.375rem;
  border-radius: 0.25rem;
  outline: none;
  transition:
    background 0.15s,
    max-width 0.2s ease;
}
@supports (field-sizing: content) {
  .chat-header__title-input {
    field-sizing: content;
    width: auto;
    min-width: 2.5em;
  }
}
.chat-header__title-input:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.chat-header__title-input:focus {
  max-width: 18em;
  background: rgba(var(--v-theme-on-surface), 0.04);
  box-shadow: inset 0 -0.0625rem 0 rgba(var(--v-theme-primary), 0.6);
}
.chat-header__title-input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.35);
  font-style: italic;
}
.chat-header__title-input:disabled {
  opacity: 0.5;
}

.chat-header__saving {
  color: rgb(var(--v-theme-primary)) !important;
}

.chat-header__meta {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-shrink: 0;
  min-width: 0;
}

.chat-header__settings {
  flex-shrink: 0;
  margin-left: 0.125rem;
}

.chat-header__lorebook-btn {
  color: rgba(var(--v-theme-on-surface), 0.75) !important;
}

.chat-header__lorebook-btn :deep(.chat-header__lorebook-badge .v-badge__badge) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 2em;
  height: 2.5em;
  padding: 1em;
  line-height: 1;
  transform: scale(0.3);
  transform-origin: bottom left;
  border-radius: 1em;
}

.chat-header__pill-icon {
  flex-shrink: 0;
}

.chat-header__pill-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header__pill--prompt {
  max-width: 15em;
  min-width: 0;
}

.chat-header__pill--branch {
  width: max-content;
  max-width: 8em;
  min-width: 0;
}

:deep(.chat-header__lorebook-menu .v-list-item-title) {
  max-width: 15em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.1875rem 0.5625rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: var(--radius-sm);
  background: rgb(var(--v-theme-surface-light));
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.chat-header__pill--warning {
  border-color: rgba(var(--v-theme-warning), 0.5);
  background: rgba(var(--v-theme-warning), 0.08);
  color: rgb(var(--v-theme-warning));
  font-family: var(--font-ui);
  font-size: 0.71875rem;
  letter-spacing: 0;
  text-transform: none;
}

.chat-header__pill--clickable {
  cursor: pointer;
  font: inherit;
  appearance: none;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}
.chat-header__pill--clickable:hover {
  border-color: rgba(var(--v-theme-primary), 0.35);
  background: rgba(var(--v-theme-primary), 0.06);
}

.chat-header__dot--warning {
  background: rgb(var(--v-theme-warning));
  box-shadow: 0 0 0 0.1875rem rgba(var(--v-theme-warning), 0.18);
}

@media (max-width: 40rem) {
  .chat-header {
    gap: 0.5rem;
    padding-inline: 0;
  }

  .chat-header__pill--branch .chat-header__pill-label,
  .chat-header__pill--prompt .chat-header__pill-label {
    display: none;
  }

  .chat-header__pill--branch,
  .chat-header__pill--prompt {
    width: auto;
    max-width: none;
    padding: 0.3125rem;
    justify-content: center;
  }

  .chat-header__pill--branch :deep(.v-icon),
  .chat-header__pill--prompt :deep(.v-icon) {
    font-size: 1.125rem;
  }
}
</style>
