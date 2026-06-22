<script setup lang="ts">
import ConversationContextSettings from '@/components/ConversationContextSettings.vue'
import ChatBranchPanel from '@/components/chat/ChatBranchPanel.vue'
import ChatBranchLabelDialog from '@/components/chat/ChatBranchLabelDialog.vue'
import HomeChat from '@/components/HomeChat.vue'
import {
  CHAT_CONVERSATION_ACTIONS_KEY,
} from '@/composables/chat-conversation-actions'
import { CONVERSATION_BRANCH_KEY } from '@/composables/conversation-branch-context'
import { useConversationBranches } from '@/composables/useConversationBranches'
import { useMemoryRebuild } from '@/composables/useMemoryRebuild'
import { bootstrapAppData } from '@/bootstrap/app-data'
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
import { storeToRefs } from 'pinia'
import { computed, provide, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const props = defineProps<{
  conversationId: string
}>()

const { t } = useI18n()
const router = useRouter()
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
  forkTurnIdsWithSiblings,
  activeBranchDisplayLabel,
  syncActiveFromIndex,
  refreshBranchTree,
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

const branchSnackOpen = ref(false)
const branchSnackText = ref('')
const branchSnackColor = ref<'success' | 'error'>('error')
const branchSnackTimeout = ref(4000)

watch(branchSuccessMessage, (msg) => {
  const text = msg.trim()
  if (!text) return
  branchSnackText.value = text
  branchSnackColor.value = 'success'
  branchSnackTimeout.value = 3000
  branchSnackOpen.value = true
  branchSuccessMessage.value = ''
})

watch(branchActionError, (msg) => {
  const text = msg.trim()
  if (!text) return
  branchSnackText.value = text
  branchSnackColor.value = 'error'
  branchSnackTimeout.value = 4000
  branchSnackOpen.value = true
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
  const ftsMatches = hybridFtsSpecsMatch(
    conversationMemoryHybridFtsSpec.value,
    globalHybridFtsSettings.value,
  )
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

interface ConvContextBindings {
  promptPresetId: string | null
  characterIds: string[]
  lorebookIds: string[]
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
  })
}

function globalBudgetTrimFromStore(): BudgetTrimSettings {
  return normalizeBudgetTrimSettings(budgetTrimSettings.value)
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
  if (typeof idx.characterId === 'string' && idx.characterId.trim()) {
    return [idx.characterId.trim()]
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
  const un = idx.userName
  const userName =
    typeof un === 'string' && un.trim() ? un.trim() : null
  const uci = idx.userCharacterId
  const userCharacterId =
    typeof uci === 'string' && uci.trim() ? uci.trim() : null
  return {
    promptPresetId,
    characterIds: clientResolvedCharacterIds(idx),
    lorebookIds,
    lorebook: lorebookContextFromIndex(idx),
    history: historyContextFromIndex(idx),
    memory: memoryContextFromIndex(idx),
    budgetTrim: budgetTrimContextFromIndex(idx),
    chatApi: chatApiContextFromIndex(idx),
    embeddingApi: embeddingApiContextFromIndex(idx),
    userName,
    userCharacterId,
    authorsNote: authorsNoteFromIndex(idx),
  }
}

const convBindings = ref<ConvContextBindings>({
  promptPresetId: null,
  characterIds: [],
  lorebookIds: [],
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
    effective: { memoryEnabled: false, memoryTopK: 4 },
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
  authorsNote: normalizeAuthorsNote(),
})

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

function onConvContextPatched(index: Record<string, unknown>) {
  applyConversationMemoryIndexMeta(index)
  convBindings.value = bindingsFromIndex(index)
  maybePromptMemoryRebuild()
}

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

watch([memoryEnabled, memoryTopK], () => {
  if (!convBindings.value.memory.useGlobal) return
  const global = globalMemoryFromStore()
  convBindings.value = {
    ...convBindings.value,
    memory: {
      useGlobal: true,
      effective: global,
    },
  }
})

async function ensureConversation(id: string) {
  loading.value = true
  errorText.value = ''
  try {
    await bootstrapAppData()
    if (!promptsStore.loaded) {
      await promptsStore.loadIndexFromServer()
    }
    await loadLorebookNameMap()
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
        errorText.value = t('chatConversation.loadFailed')
        return
      }
      const defaultLorebookIds = await fetchDefaultLorebookIds()
      if (defaultLorebookIds.length > 0) {
        await fetch(`/api/chat/conversations/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lorebookIds: defaultLorebookIds }),
        })
      }
      res = await fetch(`/api/chat/conversations/${id}`)
    }
    if (!res.ok) {
      errorText.value = t('chatConversation.loadFailed')
      return
    }
    const idx = (await res.json()) as Record<string, unknown>
    title.value = typeof idx.title === 'string' ? idx.title : t('chat.newConversation')
    hasConversationTurns.value =
      typeof idx.headChunkFile === 'string' && idx.headChunkFile.length > 0
    applyConversationMemoryIndexMeta(idx)
    convBindings.value = bindingsFromIndex(idx)
    syncActiveFromIndex(idx)
    void refreshBranchTree()
    void patchAuditDebugToServer(id)
    maybePromptMemoryRebuild()
  } catch {
    errorText.value = t('chatConversation.loadFailed')
  } finally {
    loading.value = false
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
    void ensureConversation(id)
  },
  { immediate: true },
)

/** 偏好变更时同步会话索引中的 prompt 快照开关（maxStored=0 表示不写） */
watch(
  () =>
    [
      props.conversationId,
      prefStore.writeChatPromptSnapshot,
      prefStore.promptDebugMaxStored,
    ] as const,
  ([id]) => {
    if (!id || loading.value) return
    void patchAuditDebugToServer(id)
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
    :class="{ 'chat_pane--state': loading || !!errorText }"
  >
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
      <header class="chat-header">
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
      <HomeChat
        ref="homeChatRef"
        :conversation-id="conversationId"
        :conversation-prompt-preset-id="convBindings.promptPresetId"
        :conversation-character-ids="convBindings.characterIds"
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
        @select="switchActiveBranch"
        @delete="deleteBranch"
        @rename="renameBranch"
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
      <v-snackbar
        v-model="branchSnackOpen"
        :timeout="branchSnackTimeout"
        location="bottom"
        :color="branchSnackColor"
      >
        {{ branchSnackText }}
      </v-snackbar>
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
      <ConversationContextSettings
        ref="convContextSettingsRef"
        :conversation-id="conversationId"
        :conversation-title="title"
        :initial-prompt-preset-id="convBindings.promptPresetId"
        :initial-character-ids="convBindings.characterIds"
        :initial-lorebook-ids="convBindings.lorebookIds"
        :initial-lorebook-settings-use-global="convBindings.lorebook.useGlobal"
        :global-lore-recursive-enabled="lorebookRecursiveEnabled"
        :global-lore-max-recursion-depth="lorebookMaxRecursionDepth"
        :initial-lorebook-recursive-enabled="convBindings.lorebook.effective.recursiveEnabled"
        :initial-lorebook-max-recursion-depth="convBindings.lorebook.effective.maxRecursionDepth"
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
        :conversation-memory-hybrid-fts-spec="conversationMemoryHybridFtsSpec"
        :global-hybrid-fts-spec="globalHybridFtsSpec"
        :initial-user-name="convBindings.userName"
        :initial-user-character-id="convBindings.userCharacterId"
        :initial-authors-note="convBindings.authorsNote"
        :initial-api-preset="convBindings.chatApi.apiPresetRaw"
        :initial-chat-api-use-global="convBindings.chatApi.useGlobal"
        :initial-embedding-api-use-global="convBindings.embeddingApi.useGlobal"
        :initial-embedding-api-settings="convBindings.embeddingApi.override"
        @patched="onConvContextPatched"
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
</style>
