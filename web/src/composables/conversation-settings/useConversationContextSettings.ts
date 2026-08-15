import {
  useInjectedMemoryRebuild,
} from '@/composables/useMemoryRebuild'
import {
  type CharItem,
  type LorebookItem,
  type LoreRecursionDepth,
  type SettingsSection,
} from '@/composables/conversation-settings/types'
import { usePromptsStore } from '@/stores/prompts'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { apiFetch } from '@/utils/api-fetch'
import {
  normalizeAuthorsNote,
  normalizeDefaultAuthorsNoteTemplate,
  type AuthorsNoteRole,
  type AuthorsNoteSettings,
  type DefaultAuthorsNoteTemplate,
} from '@/utils/authors-note-settings'
import { usePreferencesStore } from '@/stores/preferences'
import { fetchPluginsManage } from '@/utils/plugin-settings-api'
import {
  readConversationChatBinding,
  type ConversationChatBinding,
  type ConversationEmbeddingApiSettingsOverride,
} from '@/utils/conversation-api-settings'
import {
  BUDGET_TRIM_SETTINGS_DEFAULTS,
  budgetTrimSettingsEqual,
  cloneBudgetTrimSettings,
  normalizeBudgetTrimSettings,
  type BudgetTrimSettings,
} from '@/utils/budget-trim-settings'
import {
  normalizeLorebookSettings,
  type LorebookSettings,
} from '@/utils/lorebook-settings'
import {
  normalizeHybridFtsSettings,
  resolveEffectiveHybridFtsSettings,
  type HybridFtsDictVariant,
  type HybridFtsProfile,
  type HybridFtsSettings,
} from '@/utils/hybrid-fts-settings'
import { memoryIndexMatchesEffectiveSettings } from '@/utils/memory-index-settings'
import {
  groupChatWithEnsuredMemberColors,
  normalizeGroupChatSettings,
  type GroupChatSettings,
} from '@/utils/group-chat-settings'

export type { SettingsSection }

export type ConversationContextSettingsProps = {
  conversationId: string
  pluginHost?: import('@/plugins/injection').PluginHostContext | null
  conversationTitle?: string | null
  initialPromptPresetId?: string | null
  initialCharacterIds: string[]
  initialGroupChat?: GroupChatSettings | null
  initialLorebookIds: string[]
  initialLorebookSettingsUseGlobal?: boolean
  globalLoreRecursiveEnabled?: boolean
  globalLoreMaxRecursionDepth?: number
  globalLoreKeywordTopK?: number
  globalLoreVectorEnabled?: boolean
  globalLoreVectorTopK?: number
  initialLorebookRecursiveEnabled?: boolean
  initialLorebookMaxRecursionDepth?: number
  initialLorebookKeywordTopK?: number
  initialLorebookVectorEnabled?: boolean
  initialLorebookVectorTopK?: number
  initialKnowledgeBaseIds?: string[]
  initialKnowledgeSettingsUseGlobal?: boolean
  globalKnowledgeTopK?: number
  initialKnowledgeTopK?: number
  initialHistorySettingsUseGlobal?: boolean
  globalHistoryLimitEnabled?: boolean
  globalHistoryMaxTurns?: number
  initialHistoryLimitEnabled?: boolean
  initialHistoryMaxTurns?: number
  initialMemorySettingsUseGlobal?: boolean
  globalMemoryEnabled?: boolean
  globalMemoryTopK?: number
  initialMemoryEnabled?: boolean
  initialMemoryTopK?: number
  initialBudgetTrimSettingsUseGlobal?: boolean
  globalBudgetTrimSettings?: BudgetTrimSettings
  initialBudgetTrimSettings?: BudgetTrimSettings
  globalEmbeddingModel?: string
  effectiveEmbeddingModel: string
  effectiveEmbeddingProfile: string
  conversationMemoryEmbeddingModel?: string | null
  conversationMemoryEmbeddingDimensions?: number | null
  conversationMemoryEmbeddingProfile?: string | null
  hasConversationTurns?: boolean
  conversationMemoryHybridFtsSpec?: string | null
  globalHybridFtsSettings: HybridFtsSettings
  initialMemoryHybridFtsUseGlobal?: boolean
  initialMemoryHybridFtsSettings?: HybridFtsSettings
  initialUserName?: string | null
  initialUserCharacterId?: string | null
  initialBackgroundImageFileId?: string | null
  initialBgmFileId?: string | null
  initialAuthorsNote?: AuthorsNoteSettings
  initialApiPreset?: unknown
  initialChatApiUseGlobal?: boolean
  initialEmbeddingApiUseGlobal?: boolean
  initialEmbeddingApiSettings?: ConversationEmbeddingApiSettingsOverride
  globalEmbeddingDimensions?: number | null
}

export type ConversationContextSettingsEmit = {
  (e: 'patched', index: Record<string, unknown>, conversationId: string): void
  (e: 'memoryRebuilt', result: {
    embeddingModel: string
    hybridFtsSpec: string
  }): void
  (e: 'regexApplied'): void
}

export function useConversationContextSettings(
  props: ConversationContextSettingsProps,
  emit: ConversationContextSettingsEmit,
) {
const { t } = useI18n()
const promptsStore = usePromptsStore()
const { presets, loaded: promptsLoaded } = storeToRefs(promptsStore)

const dialogOpen = ref(false)
const recallTestDialogOpen = ref(false)
const activeSection = ref<SettingsSection>('bindings')
let catalogFetchGen = 0
let patchChain: Promise<void> = Promise.resolve()

const INHERIT_VALUE = ''

const presetModel = ref<string>(INHERIT_VALUE)
const characterModel = ref<string[]>([])
const userCharacterModel = ref<string | null>(null)
const backgroundImageFileId = ref<string | null>(null)
const bgmFileId = ref<string | null>(null)

const savingPreset = ref(false)
const savingChars = ref(false)
const savingUserCharacter = ref(false)
const savingBackgroundImage = ref(false)
const savingBgm = ref(false)
const savingLorebooks = ref(false)
const savingLoreSettings = ref(false)
const savingKnowledgeBases = ref(false)
const savingKnowledgeSettings = ref(false)
const savingHistorySettings = ref(false)
const savingMemorySettings = ref(false)
const savingMemoryHybridFts = ref(false)
const savingBudgetTrimSettings = ref(false)
const savingAuthorsNote = ref(false)
const savingDefaultAuthorsNote = ref(false)
const savingApiSettings = ref(false)
const apiChatDraftActive = ref(false)
const apiEmbeddingDraftActive = ref(false)
const chatApiUseGlobal = ref(true)
const embeddingApiUseGlobal = ref(true)
const errorText = ref('')

const lorebookModel = ref<string[]>([])
const knowledgeBaseModel = ref<string[]>([])
const knowledgeUseGlobal = ref(true)
const knowledgeTopK = ref(4)
const loreUseGlobal = ref(true)
const loreRecursiveEnabled = ref(false)
const loreMaxRecursionDepth = ref<LoreRecursionDepth>(2)
const loreKeywordTopK = ref(64)
const loreVectorEnabled = ref(false)
const loreVectorTopK = ref(5)

const loreDepthItems: LoreRecursionDepth[] = [0, 1, 2, 3]

const historyUseGlobal = ref(true)
const historyLimitEnabled = ref(false)
const historyMaxTurns = ref(20)

const memoryUseGlobal = ref(true)
const memoryEnabled = ref(false)
const memoryTopK = ref(4)
const memoryHybridFtsUseGlobal = ref(true)
const memoryHybridFtsProfile = ref<HybridFtsProfile>('zh-ngram')
const memoryHybridFtsDictVariant = ref<HybridFtsDictVariant | null>(null)
const memoryHybridFtsSwitchOpen = ref(false)
const pendingMemoryHybridFtsProfile = ref<HybridFtsProfile>('zh-ngram')

const budgetTrimUseGlobal = ref(true)
const budgetTrimModel = ref<BudgetTrimSettings>(
  cloneBudgetTrimSettings(BUDGET_TRIM_SETTINGS_DEFAULTS),
)

const authorsNoteEnabled = ref(false)
const authorsNoteContent = ref('')
const authorsNoteDepth = ref(4)
const authorsNoteRole = ref<AuthorsNoteRole>('system')

const preferencesStore = usePreferencesStore()
const defaultAuthorsNoteContent = ref('')
const defaultAuthorsNoteDepth = ref(4)
const defaultAuthorsNoteRole = ref<AuthorsNoteRole>('system')
const defaultAuthorsNoteEnabledForNewChats = ref(true)

const authorsNoteContentTrimmed = computed(() => authorsNoteContent.value.trim())
const canToggleAuthorsNoteEnabled = computed(
  () => authorsNoteContentTrimmed.value.length > 0,
)

const displayConversationTitle = computed(() => {
  const raw = props.conversationTitle?.trim()
  return raw || t('chat.newConversation')
})

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
} = useInjectedMemoryRebuild()

const effectiveMemoryEnabled = computed(() =>
  memoryUseGlobal.value
    ? props.globalMemoryEnabled === true
    : memoryEnabled.value,
)

const effectiveMemoryHybridFts = computed(() =>
  resolveEffectiveHybridFtsSettings(
    normalizeHybridFtsSettings(props.globalHybridFtsSettings),
    memoryHybridFtsUseGlobal.value
      ? undefined
      : {
          profile: memoryHybridFtsProfile.value,
          dictVariant: memoryHybridFtsDictVariant.value,
        },
  ),
)

const memoryRebuildNeedsAttention = computed(() => {
  if (!effectiveMemoryEnabled.value) return false
  if (props.hasConversationTurns === false) return false
  const effectiveModel = props.effectiveEmbeddingModel.trim()
  if (!effectiveModel) return false
  const storedModel = props.conversationMemoryEmbeddingModel?.trim() ?? ''
  if (!storedModel) return false
  const storedDims = props.conversationMemoryEmbeddingDimensions ?? null
  const indexMatches = memoryIndexMatchesEffectiveSettings(
    {
      embeddingProfile: props.conversationMemoryEmbeddingProfile,
      embeddingModel: storedModel,
      embeddingDimensions: storedDims,
    },
    { embeddingProfile: props.effectiveEmbeddingProfile },
    props.conversationMemoryHybridFtsSpec,
    effectiveMemoryHybridFts.value,
  )
  return !indexMatches
})

async function onRebuildMemoryClick() {
  const result = await rebuildMemoryIndex()
  if (result) emit('memoryRebuilt', result)
}

const charItems = ref<CharItem[]>([])
const charItemsLoading = ref(false)
const lorebookItems = ref<LorebookItem[]>([])
const lorebookItemsLoading = ref(false)
const knowledgeBaseItems = ref<LorebookItem[]>([])
const knowledgeBaseItemsLoading = ref(false)
const showPluginsTab = ref(false)
const savingPluginSettings = ref(false)
const pluginTabApi = ref<{
  reload: () => void
  backToList: () => void
} | null>(null)
const regexTabApi = ref<{
  reload: () => void
} | null>(null)

function bindPluginTabApi(api: {
  reload: () => void
  backToList: () => void
} | null) {
  pluginTabApi.value = api
}

function bindRegexTabApi(api: { reload: () => void } | null) {
  regexTabApi.value = api
}

const sectionItems = computed(() => {
  const items: Array<{
    id: SettingsSection
    title: string
    icon: string
  }> = [
    {
      id: 'bindings',
      title: t('chat.convSettings.tabBindings'),
      icon: 'mdi-link-variant',
    },
    {
      id: 'api',
      title: t('chat.convSettings.tabApi'),
      icon: 'mdi-api',
    },
    {
      id: 'context',
      title: t('settings.navHistory'),
      icon: 'mdi-history',
    },
    {
      id: 'lore',
      title: t('settings.navLorebook'),
      icon: 'mdi-book-open-page-variant-outline',
    },
    {
      id: 'vectorRecall',
      title: t('settings.navVectorRecall'),
      icon: 'mdi-database-search-outline',
    },
    {
      id: 'budgetTrim',
      title: t('chat.convSettings.tabBudgetTrim'),
      icon: 'mdi-scissors-cutting',
    },
    {
      id: 'authorsNote',
      title: t('chat.convSettings.tabAuthorsNote'),
      icon: 'mdi-note-text-outline',
    },
    {
      id: 'regexApply',
      title: t('chat.convSettings.tabRegexApply'),
      icon: 'mdi-regex',
    },
  ]
  if (showPluginsTab.value) {
    items.push({
      id: 'plugins',
      title: t('chat.convSettings.tabPlugins'),
      icon: 'mdi-puzzle-outline',
    })
  }
  return items
})

const activeSectionHeader = computed(() => {
  const keyBySection: Record<
    SettingsSection,
    { titleKey: string; hintKey: string; ns?: 'chat.convSettings' | 'settings' }
  > = {
    bindings: {
      titleKey: 'tabBindings',
      hintKey: 'tabBindingsHint',
    },
    api: { titleKey: 'tabApi', hintKey: 'tabApiHint' },
    lore: { titleKey: 'tabLore', hintKey: 'tabLoreHint' },
    context: {
      titleKey: 'navHistory',
      hintKey: 'historySectionHint',
      ns: 'settings',
    },
    vectorRecall: {
      titleKey: 'tabVectorRecall',
      hintKey: 'tabVectorRecallHint',
    },
    budgetTrim: {
      titleKey: 'tabBudgetTrim',
      hintKey: 'tabBudgetTrimHint',
    },
    authorsNote: {
      titleKey: 'tabAuthorsNote',
      hintKey: 'tabAuthorsNoteHint',
    },
    regexApply: {
      titleKey: 'tabRegexApply',
      hintKey: 'tabRegexApplyHint',
    },
    plugins: { titleKey: 'tabPlugins', hintKey: 'tabPluginsHint' },
  }
  const keys = keyBySection[activeSection.value]
  const ns = keys.ns ?? 'chat.convSettings'
  return {
    title: t(`${ns}.${keys.titleKey}`),
    hint: t(`${ns}.${keys.hintKey}`),
  }
})

const presetItems = computed(() => {
  const inherit = {
    title: t('chat.convSettings.useGlobalPreset'),
    value: INHERIT_VALUE,
  }
  const rest = presets.value.map((p) => ({
    title: p.name,
    value: p.id,
  }))
  return [inherit, ...rest]
})

const isSaving = computed(
  () =>
    savingPreset.value ||
    savingChars.value ||
    savingUserCharacter.value ||
    savingBackgroundImage.value ||
    savingBgm.value ||
    savingLorebooks.value ||
    savingLoreSettings.value ||
    savingHistorySettings.value ||
    savingMemorySettings.value ||
    savingMemoryHybridFts.value ||
    savingBudgetTrimSettings.value ||
    savingAuthorsNote.value ||
    savingDefaultAuthorsNote.value ||
    savingApiSettings.value ||
    savingPluginSettings.value,
)

function open(section?: SettingsSection): void {
  syncFromProps()
  catalogFetchGen++
  void loadCharacters()
  void loadLorebooks()
  void loadKnowledgeBases()
  void refreshPluginsTabVisibility()
  if (section === 'plugins' && !showPluginsTab.value) {
    activeSection.value = 'bindings'
  } else {
    activeSection.value = section ?? 'bindings'
  }
  dialogOpen.value = true
  if (activeSection.value === 'plugins') {
    void pluginTabApi.value?.reload()
  }
  if (activeSection.value === 'regexApply') {
    void regexTabApi.value?.reload()
  }
}

function close(): void {
  dialogOpen.value = false
}

watch(activeSection, (section) => {
  if (section !== 'plugins') {
    pluginTabApi.value?.backToList()
  }
  if (section === 'regexApply') {
    void regexTabApi.value?.reload()
  }
})

watch(dialogOpen, (open) => {
  if (!open) {
    apiChatDraftActive.value = false
    apiEmbeddingDraftActive.value = false
    syncFromProps()
  }
})

function onChatUseGlobalLocalChange(useGlobal: boolean) {
  chatApiUseGlobal.value = useGlobal
  apiChatDraftActive.value = !useGlobal
}

function onEmbeddingUseGlobalLocalChange(useGlobal: boolean) {
  embeddingApiUseGlobal.value = useGlobal
  apiEmbeddingDraftActive.value = !useGlobal
}

function currentPresetTarget(): string | null {
  const v = presetModel.value.trim()
  if (!v || v === INHERIT_VALUE) return null
  return v
}

function propsPresetTarget(): string | null {
  const s = props.initialPromptPresetId
  return typeof s === 'string' && s.trim() ? s.trim() : null
}

function propsLoreUseGlobal(): boolean {
  return props.initialLorebookSettingsUseGlobal !== false
}

function propsGlobalLoreRecursiveEnabled(): boolean {
  return props.globalLoreRecursiveEnabled === true
}

function clampLoreDepth(raw: number | undefined | null): LoreRecursionDepth {
  const d =
    typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 2
  const v = Math.max(0, Math.min(3, d))
  return v as LoreRecursionDepth
}

function propsGlobalLoreMaxRecursionDepth(): LoreRecursionDepth {
  return clampLoreDepth(props.globalLoreMaxRecursionDepth)
}

function propsLoreRecursiveEnabled(): boolean {
  return props.initialLorebookRecursiveEnabled === true
}

function propsLoreMaxRecursionDepth(): LoreRecursionDepth {
  return clampLoreDepth(props.initialLorebookMaxRecursionDepth)
}

function propsGlobalLoreKeywordTopK(): number {
  return normalizeLorebookSettings({
    keywordTopK: props.globalLoreKeywordTopK,
  }).keywordTopK
}

function propsGlobalLoreVectorEnabled(): boolean {
  return normalizeLorebookSettings({
    vectorEnabled: props.globalLoreVectorEnabled,
  }).vectorEnabled
}

function propsGlobalLoreVectorTopK(): number {
  return normalizeLorebookSettings({
    vectorTopK: props.globalLoreVectorTopK,
  }).vectorTopK
}

function propsLoreKeywordTopK(): number {
  return normalizeLorebookSettings({
    keywordTopK: props.initialLorebookKeywordTopK,
  }).keywordTopK
}

function propsLoreVectorEnabled(): boolean {
  return normalizeLorebookSettings({
    vectorEnabled: props.initialLorebookVectorEnabled,
  }).vectorEnabled
}

function propsLoreVectorTopK(): number {
  return normalizeLorebookSettings({
    vectorTopK: props.initialLorebookVectorTopK,
  }).vectorTopK
}

function syncLoreFieldsFromProps(): void {
  if (loreUseGlobal.value) {
    loreRecursiveEnabled.value = propsGlobalLoreRecursiveEnabled()
    loreMaxRecursionDepth.value = propsGlobalLoreMaxRecursionDepth()
    loreKeywordTopK.value = propsGlobalLoreKeywordTopK()
    loreVectorEnabled.value = propsGlobalLoreVectorEnabled()
    loreVectorTopK.value = propsGlobalLoreVectorTopK()
  } else {
    loreRecursiveEnabled.value = propsLoreRecursiveEnabled()
    loreMaxRecursionDepth.value = propsLoreMaxRecursionDepth()
    loreKeywordTopK.value = propsLoreKeywordTopK()
    loreVectorEnabled.value = propsLoreVectorEnabled()
    loreVectorTopK.value = propsLoreVectorTopK()
  }
}

function buildLorebookSettingsOverride(): LorebookSettings {
  return normalizeLorebookSettings({
    recursiveEnabled: loreRecursiveEnabled.value,
    maxRecursionDepth: loreMaxRecursionDepth.value,
    keywordTopK: loreKeywordTopK.value,
    vectorEnabled: loreVectorEnabled.value,
    vectorTopK: loreVectorTopK.value,
  })
}

function propsHistoryUseGlobal(): boolean {
  return props.initialHistorySettingsUseGlobal !== false
}

function propsGlobalHistoryLimitEnabled(): boolean {
  return props.globalHistoryLimitEnabled === true
}

function propsGlobalHistoryMaxTurns(): number {
  const d = props.globalHistoryMaxTurns
  if (typeof d !== 'number' || !Number.isFinite(d)) return 20
  return Math.max(1, Math.min(200, Math.floor(d)))
}

function propsHistoryLimitEnabled(): boolean {
  return props.initialHistoryLimitEnabled === true
}

function propsHistoryMaxTurns(): number {
  const d = props.initialHistoryMaxTurns
  if (typeof d !== 'number' || !Number.isFinite(d)) return 20
  return Math.max(1, Math.min(200, Math.floor(d)))
}

function propsMemoryUseGlobal(): boolean {
  return props.initialMemorySettingsUseGlobal !== false
}

function propsGlobalMemoryEnabled(): boolean {
  return props.globalMemoryEnabled === true
}

function propsGlobalMemoryTopK(): number {
  const d = props.globalMemoryTopK
  if (typeof d !== 'number' || !Number.isFinite(d)) return 4
  return Math.max(1, Math.min(20, Math.floor(d)))
}

function propsMemoryEnabled(): boolean {
  return props.initialMemoryEnabled === true
}

function propsMemoryTopK(): number {
  const d = props.initialMemoryTopK
  if (typeof d !== 'number' || !Number.isFinite(d)) return 4
  return Math.max(1, Math.min(20, Math.floor(d)))
}

function propsMemoryHybridFtsUseGlobal(): boolean {
  return props.initialMemoryHybridFtsUseGlobal !== false
}

function propsMemoryHybridFtsSettings(): HybridFtsSettings {
  return normalizeHybridFtsSettings(
    propsMemoryHybridFtsUseGlobal()
      ? props.globalHybridFtsSettings
      : props.initialMemoryHybridFtsSettings,
  )
}

function propsKnowledgeUseGlobal(): boolean {
  return props.initialKnowledgeSettingsUseGlobal !== false
}

function propsGlobalKnowledgeTopK(): number {
  const d = props.globalKnowledgeTopK
  if (typeof d !== 'number' || !Number.isFinite(d)) return 4
  return Math.max(1, Math.min(32, Math.floor(d)))
}

function propsKnowledgeTopK(): number {
  const d = props.initialKnowledgeTopK
  if (typeof d !== 'number' || !Number.isFinite(d)) return 4
  return Math.max(1, Math.min(32, Math.floor(d)))
}

function propsBudgetTrimUseGlobal(): boolean {
  return props.initialBudgetTrimSettingsUseGlobal !== false
}

function propsGlobalBudgetTrimSettings(): BudgetTrimSettings {
  return normalizeBudgetTrimSettings(props.globalBudgetTrimSettings)
}

function propsBudgetTrimSettings(): BudgetTrimSettings {
  return normalizeBudgetTrimSettings(props.initialBudgetTrimSettings)
}

function propsUserCharacterId(): string | null {
  const id = props.initialUserCharacterId
  return typeof id === 'string' && id.trim() ? id.trim() : null
}

function propsBackgroundImageFileId(): string | null {
  const id = props.initialBackgroundImageFileId
  return typeof id === 'string' && id.trim() ? id.trim().toLowerCase() : null
}

function propsBgmFileId(): string | null {
  const id = props.initialBgmFileId
  return typeof id === 'string' && id.trim() ? id.trim().toLowerCase() : null
}

function propsAuthorsNote(): AuthorsNoteSettings {
  return normalizeAuthorsNote(props.initialAuthorsNote)
}

function propsChatBinding(): ConversationChatBinding | null {
  return readConversationChatBinding(props.initialApiPreset)
}

function propsEmbeddingOverride(): ConversationEmbeddingApiSettingsOverride | undefined {
  return props.initialEmbeddingApiSettings
}

function syncFromProps() {
  errorText.value = ''
  presetModel.value = propsPresetTarget() ?? INHERIT_VALUE
  characterModel.value = [...props.initialCharacterIds]
  userCharacterModel.value = propsUserCharacterId()
  backgroundImageFileId.value = propsBackgroundImageFileId()
  bgmFileId.value = propsBgmFileId()
  lorebookModel.value = [...props.initialLorebookIds]
  knowledgeBaseModel.value = [...(props.initialKnowledgeBaseIds ?? [])]
  knowledgeUseGlobal.value = propsKnowledgeUseGlobal()
  knowledgeTopK.value = knowledgeUseGlobal.value
    ? propsGlobalKnowledgeTopK()
    : propsKnowledgeTopK()
  loreUseGlobal.value = propsLoreUseGlobal()
  syncLoreFieldsFromProps()
  historyUseGlobal.value = propsHistoryUseGlobal()
  if (historyUseGlobal.value) {
    historyLimitEnabled.value = propsGlobalHistoryLimitEnabled()
    historyMaxTurns.value = propsGlobalHistoryMaxTurns()
  } else {
    historyLimitEnabled.value = propsHistoryLimitEnabled()
    historyMaxTurns.value = propsHistoryMaxTurns()
  }
  memoryUseGlobal.value = propsMemoryUseGlobal()
  if (memoryUseGlobal.value) {
    memoryEnabled.value = propsGlobalMemoryEnabled()
    memoryTopK.value = propsGlobalMemoryTopK()
  } else {
    memoryEnabled.value = propsMemoryEnabled()
    memoryTopK.value = propsMemoryTopK()
  }
  memoryHybridFtsUseGlobal.value = propsMemoryHybridFtsUseGlobal()
  if (!savingMemoryHybridFts.value && !memoryHybridFtsSwitchOpen.value) {
    const hybridFts = propsMemoryHybridFtsSettings()
    memoryHybridFtsProfile.value = hybridFts.profile
    memoryHybridFtsDictVariant.value = hybridFts.dictVariant ?? null
    pendingMemoryHybridFtsProfile.value = hybridFts.profile
  }
  budgetTrimUseGlobal.value = propsBudgetTrimUseGlobal()
  if (budgetTrimUseGlobal.value) {
    budgetTrimModel.value = cloneBudgetTrimSettings(
      propsGlobalBudgetTrimSettings(),
    )
  } else {
    budgetTrimModel.value = cloneBudgetTrimSettings(propsBudgetTrimSettings())
  }
  const an = propsAuthorsNote()
  authorsNoteEnabled.value = an.enabled
  authorsNoteContent.value = an.content
  authorsNoteDepth.value = an.injectionDepth
  authorsNoteRole.value = an.role
  const dan = normalizeDefaultAuthorsNoteTemplate(preferencesStore.defaultAuthorsNote)
  defaultAuthorsNoteContent.value = dan.content
  defaultAuthorsNoteDepth.value = dan.injectionDepth
  defaultAuthorsNoteRole.value = dan.role
  defaultAuthorsNoteEnabledForNewChats.value = dan.enabledForNewChats
  if (!apiChatDraftActive.value && !savingApiSettings.value) {
    chatApiUseGlobal.value = props.initialChatApiUseGlobal !== false
  }
  if (!apiEmbeddingDraftActive.value && !savingApiSettings.value) {
    embeddingApiUseGlobal.value = props.initialEmbeddingApiUseGlobal !== false
  }
}

watch(
  () => [
    props.conversationId,
    props.initialPromptPresetId,
    props.initialCharacterIds,
    props.initialLorebookIds,
    props.initialKnowledgeBaseIds,
    props.initialKnowledgeSettingsUseGlobal,
    props.globalKnowledgeTopK,
    props.initialKnowledgeTopK,
    props.initialLorebookSettingsUseGlobal,
    props.globalLoreRecursiveEnabled,
    props.globalLoreMaxRecursionDepth,
    props.globalLoreKeywordTopK,
    props.globalLoreVectorEnabled,
    props.globalLoreVectorTopK,
    props.initialLorebookRecursiveEnabled,
    props.initialLorebookMaxRecursionDepth,
    props.initialLorebookKeywordTopK,
    props.initialLorebookVectorEnabled,
    props.initialLorebookVectorTopK,
    props.initialHistorySettingsUseGlobal,
    props.globalHistoryLimitEnabled,
    props.globalHistoryMaxTurns,
    props.initialHistoryLimitEnabled,
    props.initialHistoryMaxTurns,
    props.initialMemorySettingsUseGlobal,
    props.globalMemoryEnabled,
    props.globalMemoryTopK,
    props.initialMemoryEnabled,
    props.initialMemoryTopK,
    props.globalHybridFtsSettings,
    props.initialMemoryHybridFtsUseGlobal,
    props.initialMemoryHybridFtsSettings,
    props.initialBudgetTrimSettingsUseGlobal,
    props.globalBudgetTrimSettings,
    props.initialBudgetTrimSettings,
    props.initialUserName,
    props.initialUserCharacterId,
    props.initialBackgroundImageFileId,
    props.initialBgmFileId,
    props.initialAuthorsNote,
    props.initialApiPreset,
    props.initialChatApiUseGlobal,
    props.initialEmbeddingApiUseGlobal,
    props.initialEmbeddingApiSettings,
  ],
  () => syncFromProps(),
  { deep: true },
)

watch(userCharacterModel, async (id) => {
  const next =
    typeof id === 'string' && id.trim() ? id.trim() : null
  if (next === propsUserCharacterId()) return
  savingUserCharacter.value = true
  errorText.value = ''
  try {
    const card = next
      ? charItems.value.find((c) => c.id === next)
      : undefined
    const userName =
      card && card.name.trim() ? card.name.trim() : null
    await patchConversation({
      userCharacterId: next,
      userName,
    })
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingUserCharacter.value = false
  }
})

async function onBackgroundImageFileId(id: string | null) {
  const next =
    typeof id === 'string' && id.trim() ? id.trim().toLowerCase() : null
  if (next === propsBackgroundImageFileId()) return
  backgroundImageFileId.value = next
  savingBackgroundImage.value = true
  errorText.value = ''
  try {
    await patchConversation({ backgroundImageFileId: next })
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingBackgroundImage.value = false
  }
}

async function onBgmFileId(id: string | null) {
  const next =
    typeof id === 'string' && id.trim() ? id.trim().toLowerCase() : null
  if (next === propsBgmFileId()) return
  bgmFileId.value = next
  savingBgm.value = true
  errorText.value = ''
  try {
    await patchConversation({ bgmFileId: next })
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingBgm.value = false
  }
}

watch(presetModel, async () => {
  const target = currentPresetTarget()
  const cur = propsPresetTarget()
  if (target === cur) return
  savingPreset.value = true
  errorText.value = ''
  try {
    await patchConversation({
      promptPresetId: target,
    })
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingPreset.value = false
  }
})

watch(
  characterModel,
  async (ids) => {
    const a = [...ids].sort().join('\u0000')
    const b = [...props.initialCharacterIds].sort().join('\u0000')
    if (a === b) return
    savingChars.value = true
    errorText.value = ''
    try {
      const body: Record<string, unknown> = { characterIds: [...ids] }
      const gc = normalizeGroupChatSettings(props.initialGroupChat)
      if (gc.enabled) {
        body.groupChat = groupChatWithEnsuredMemberColors(gc, ids)
      }
      await patchConversation(body)
    } catch (e) {
      errorText.value =
        e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
      syncFromProps()
    } finally {
      savingChars.value = false
    }
  },
  { deep: true },
)

watch(
  lorebookModel,
  async (ids) => {
    const a = [...ids].sort().join('\u0000')
    const b = [...props.initialLorebookIds].sort().join('\u0000')
    if (a === b) return
    savingLorebooks.value = true
    errorText.value = ''
    try {
      await patchConversation({ lorebookIds: [...ids] })
    } catch (e) {
      errorText.value =
        e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
      syncFromProps()
    } finally {
      savingLorebooks.value = false
    }
  },
  { deep: true },
)

watch(
  knowledgeBaseModel,
  async (ids) => {
    const a = [...ids].sort().join('\u0000')
    const b = [...(props.initialKnowledgeBaseIds ?? [])].sort().join('\u0000')
    if (a === b) return
    savingKnowledgeBases.value = true
    errorText.value = ''
    try {
      await patchConversation({ knowledgeBaseIds: [...ids] })
    } catch (e) {
      errorText.value =
        e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
      syncFromProps()
    } finally {
      savingKnowledgeBases.value = false
    }
  },
  { deep: true },
)

watch(knowledgeUseGlobal, async (useGlobal) => {
  if (useGlobal === propsKnowledgeUseGlobal()) return
  savingKnowledgeSettings.value = true
  errorText.value = ''
  try {
    if (useGlobal) {
      await patchConversation({ knowledgeSettings: null })
    } else {
      await patchConversation({
        knowledgeSettings: { topK: knowledgeTopK.value },
      })
    }
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingKnowledgeSettings.value = false
  }
})

watch(knowledgeTopK, async (topK) => {
  const target = knowledgeUseGlobal.value
    ? propsGlobalKnowledgeTopK()
    : propsKnowledgeTopK()
  const next =
    typeof topK === 'number' && Number.isFinite(topK)
      ? Math.max(1, Math.min(32, Math.floor(topK)))
      : target
  if (next === target) return
  savingKnowledgeSettings.value = true
  errorText.value = ''
  try {
    await patchConversation({ knowledgeSettings: { topK: next } })
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingKnowledgeSettings.value = false
  }
})

watch(loreUseGlobal, async (useGlobal) => {
  if (useGlobal === propsLoreUseGlobal()) return
  savingLoreSettings.value = true
  errorText.value = ''
  try {
    if (useGlobal) {
      await patchConversation({ lorebookSettings: null })
    } else {
      await patchConversation({
        lorebookSettings: buildLorebookSettingsOverride(),
      })
    }
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingLoreSettings.value = false
  }
})

async function saveLoreOverride() {
  await patchConversation({
    lorebookSettings: buildLorebookSettingsOverride(),
  })
}

watch(loreRecursiveEnabled, async (enabled) => {
  const target = loreUseGlobal.value
    ? propsGlobalLoreRecursiveEnabled()
    : propsLoreRecursiveEnabled()
  if (enabled === target) return
  savingLoreSettings.value = true
  errorText.value = ''
  try {
    await saveLoreOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingLoreSettings.value = false
  }
})

watch(loreMaxRecursionDepth, async (depth) => {
  const target = loreUseGlobal.value
    ? propsGlobalLoreMaxRecursionDepth()
    : propsLoreMaxRecursionDepth()
  if (depth === target) return
  savingLoreSettings.value = true
  errorText.value = ''
  try {
    await saveLoreOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingLoreSettings.value = false
  }
})

watch(loreKeywordTopK, async (topK) => {
  const target = loreUseGlobal.value
    ? propsGlobalLoreKeywordTopK()
    : propsLoreKeywordTopK()
  if (topK === target) return
  savingLoreSettings.value = true
  errorText.value = ''
  try {
    await saveLoreOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingLoreSettings.value = false
  }
})

watch(loreVectorEnabled, async (enabled) => {
  const target = loreUseGlobal.value
    ? propsGlobalLoreVectorEnabled()
    : propsLoreVectorEnabled()
  if (enabled === target) return
  savingLoreSettings.value = true
  errorText.value = ''
  try {
    await saveLoreOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingLoreSettings.value = false
  }
})

watch(loreVectorTopK, async (topK) => {
  const target = loreUseGlobal.value
    ? propsGlobalLoreVectorTopK()
    : propsLoreVectorTopK()
  if (topK === target) return
  savingLoreSettings.value = true
  errorText.value = ''
  try {
    await saveLoreOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingLoreSettings.value = false
  }
})

watch(historyUseGlobal, async (useGlobal) => {
  if (useGlobal === propsHistoryUseGlobal()) return
  savingHistorySettings.value = true
  errorText.value = ''
  try {
    if (useGlobal) {
      await patchConversation({ historySettings: null })
    } else {
      await patchConversation({
        historySettings: {
          limitEnabled: historyLimitEnabled.value,
          maxTurns: historyMaxTurns.value,
        },
      })
    }
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingHistorySettings.value = false
  }
})

async function saveHistoryOverride() {
  await patchConversation({
    historySettings: {
      limitEnabled: historyLimitEnabled.value,
      maxTurns: historyMaxTurns.value,
    },
  })
}

watch(historyLimitEnabled, async (enabled) => {
  const target = historyUseGlobal.value
    ? propsGlobalHistoryLimitEnabled()
    : propsHistoryLimitEnabled()
  if (enabled === target) return
  savingHistorySettings.value = true
  errorText.value = ''
  try {
    await saveHistoryOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingHistorySettings.value = false
  }
})

watch(historyMaxTurns, async (turns) => {
  const target = historyUseGlobal.value
    ? propsGlobalHistoryMaxTurns()
    : propsHistoryMaxTurns()
  if (turns === target) return
  savingHistorySettings.value = true
  errorText.value = ''
  try {
    await saveHistoryOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingHistorySettings.value = false
  }
})

watch(memoryUseGlobal, async (useGlobal) => {
  if (useGlobal === propsMemoryUseGlobal()) return
  savingMemorySettings.value = true
  errorText.value = ''
  try {
    if (useGlobal) {
      await patchConversation({ memorySettings: null })
    } else {
      await patchConversation({
        memorySettings: {
          memoryEnabled: memoryEnabled.value,
          memoryTopK: memoryTopK.value,
        },
      })
    }
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingMemorySettings.value = false
  }
})

async function saveMemoryOverride() {
  await patchConversation({
    memorySettings: {
      memoryEnabled: memoryEnabled.value,
      memoryTopK: memoryTopK.value,
    },
  })
}

watch(memoryEnabled, async (enabled) => {
  const target = memoryUseGlobal.value
    ? propsGlobalMemoryEnabled()
    : propsMemoryEnabled()
  if (enabled === target) return
  savingMemorySettings.value = true
  errorText.value = ''
  try {
    await saveMemoryOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingMemorySettings.value = false
  }
})

watch(memoryTopK, async (k) => {
  const target = memoryUseGlobal.value
    ? propsGlobalMemoryTopK()
    : propsMemoryTopK()
  if (k === target) return
  savingMemorySettings.value = true
  errorText.value = ''
  try {
    await saveMemoryOverride()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingMemorySettings.value = false
  }
})

async function saveMemoryHybridFtsOverride(
  settings: HybridFtsSettings,
): Promise<void> {
  await patchConversation({
    memoryHybridFts: normalizeHybridFtsSettings(settings),
  })
}

watch(memoryHybridFtsUseGlobal, async (useGlobal) => {
  if (useGlobal === propsMemoryHybridFtsUseGlobal()) return
  savingMemoryHybridFts.value = true
  errorText.value = ''
  try {
    if (useGlobal) {
      await patchConversation({ memoryHybridFts: null })
    } else {
      await saveMemoryHybridFtsOverride({
        profile: memoryHybridFtsProfile.value,
        dictVariant: memoryHybridFtsDictVariant.value,
      })
    }
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingMemoryHybridFts.value = false
    // saving 期间 syncFromProps 会跳过 hybrid 字段；落回后再对齐展示
    memoryHybridFtsUseGlobal.value = propsMemoryHybridFtsUseGlobal()
    const hybridFts = propsMemoryHybridFtsSettings()
    memoryHybridFtsProfile.value = hybridFts.profile
    memoryHybridFtsDictVariant.value = hybridFts.dictVariant ?? null
    pendingMemoryHybridFtsProfile.value = hybridFts.profile
  }
})

function onMemoryHybridFtsProfilePick(profile: HybridFtsProfile): void {
  if (memoryHybridFtsUseGlobal.value || profile === memoryHybridFtsProfile.value) {
    return
  }
  pendingMemoryHybridFtsProfile.value = profile
  memoryHybridFtsSwitchOpen.value = true
}

function openMemoryHybridFtsManageDialog(): void {
  if (memoryHybridFtsUseGlobal.value) return
  pendingMemoryHybridFtsProfile.value = memoryHybridFtsProfile.value
  memoryHybridFtsSwitchOpen.value = true
}

async function onMemoryHybridFtsSwitchConfirm(payload: {
  profile: HybridFtsProfile
  dictVariant: HybridFtsDictVariant | null
}): Promise<void> {
  savingMemoryHybridFts.value = true
  errorText.value = ''
  try {
    const settings = normalizeHybridFtsSettings(payload)
    await saveMemoryHybridFtsOverride(settings)
    memoryHybridFtsProfile.value = settings.profile
    memoryHybridFtsDictVariant.value = settings.dictVariant ?? null
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingMemoryHybridFts.value = false
    memoryHybridFtsUseGlobal.value = propsMemoryHybridFtsUseGlobal()
    const hybridFts = propsMemoryHybridFtsSettings()
    memoryHybridFtsProfile.value = hybridFts.profile
    memoryHybridFtsDictVariant.value = hybridFts.dictVariant ?? null
    pendingMemoryHybridFtsProfile.value = hybridFts.profile
  }
}

function onMemoryHybridFtsSwitchCancel(): void {
  pendingMemoryHybridFtsProfile.value = memoryHybridFtsProfile.value
}

watch(budgetTrimUseGlobal, async (useGlobal) => {
  if (useGlobal === propsBudgetTrimUseGlobal()) return
  savingBudgetTrimSettings.value = true
  errorText.value = ''
  try {
    if (useGlobal) {
      await patchConversation({ budgetTrimSettings: null })
    } else {
      await saveBudgetTrimOverride()
    }
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingBudgetTrimSettings.value = false
  }
})

async function saveBudgetTrimOverride() {
  const n = normalizeBudgetTrimSettings(budgetTrimModel.value)
  await patchConversation({
    budgetTrimSettings: {
      trimOrder: [...n.trimOrder],
      minRetain: { ...n.minRetain },
    },
  })
}

watch(
  budgetTrimModel,
  async (v) => {
    if (budgetTrimUseGlobal.value) return
    const target = propsBudgetTrimSettings()
    const n = normalizeBudgetTrimSettings(v)
    if (budgetTrimSettingsEqual(n, target)) return
    savingBudgetTrimSettings.value = true
    errorText.value = ''
    try {
      await saveBudgetTrimOverride()
    } catch (e) {
      errorText.value =
        e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
      syncFromProps()
    } finally {
      savingBudgetTrimSettings.value = false
    }
  },
  { deep: true },
)

function authorsNotePatchFromForm(): AuthorsNoteSettings {
  return normalizeAuthorsNote({
    enabled: authorsNoteEnabled.value,
    content: authorsNoteContent.value,
    injectionDepth: authorsNoteDepth.value,
    role: authorsNoteRole.value,
  })
}

function authorsNoteMatchesProps(): boolean {
  const cur = authorsNotePatchFromForm()
  const stored = propsAuthorsNote()
  return (
    cur.enabled === stored.enabled &&
    cur.content === stored.content &&
    cur.injectionDepth === stored.injectionDepth &&
    cur.role === stored.role
  )
}

async function saveAuthorsNote(): Promise<void> {
  const note = authorsNotePatchFromForm()
  await patchConversation({
    authorsNote: {
      enabled: note.enabled,
      content: note.content,
      injectionDepth: note.injectionDepth,
      role: note.role,
    },
  })
}

watch(authorsNoteContent, (content) => {
  if (!content.trim()) {
    authorsNoteEnabled.value = false
  }
})

async function onAuthorsNoteContentBlur(): Promise<void> {
  if (authorsNoteMatchesProps()) return
  savingAuthorsNote.value = true
  errorText.value = ''
  try {
    await saveAuthorsNote()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingAuthorsNote.value = false
  }
}

watch(authorsNoteEnabled, async (enabled) => {
  if (enabled === propsAuthorsNote().enabled) return
  if (enabled && !canToggleAuthorsNoteEnabled.value) {
    authorsNoteEnabled.value = false
    return
  }
  savingAuthorsNote.value = true
  errorText.value = ''
  try {
    await saveAuthorsNote()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingAuthorsNote.value = false
  }
})

watch(authorsNoteDepth, async (depth) => {
  if (depth === propsAuthorsNote().injectionDepth) return
  savingAuthorsNote.value = true
  errorText.value = ''
  try {
    await saveAuthorsNote()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingAuthorsNote.value = false
  }
})

watch(authorsNoteRole, async (role) => {
  if (role === propsAuthorsNote().role) return
  savingAuthorsNote.value = true
  errorText.value = ''
  try {
    await saveAuthorsNote()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingAuthorsNote.value = false
  }
})

function defaultAuthorsNotePatchFromForm(): DefaultAuthorsNoteTemplate {
  return normalizeDefaultAuthorsNoteTemplate({
    content: defaultAuthorsNoteContent.value,
    injectionDepth: defaultAuthorsNoteDepth.value,
    role: defaultAuthorsNoteRole.value,
    enabledForNewChats: defaultAuthorsNoteEnabledForNewChats.value,
  })
}

function defaultAuthorsNoteMatchesStore(): boolean {
  const cur = defaultAuthorsNotePatchFromForm()
  const stored = normalizeDefaultAuthorsNoteTemplate(
    preferencesStore.defaultAuthorsNote,
  )
  return (
    cur.content === stored.content &&
    cur.injectionDepth === stored.injectionDepth &&
    cur.role === stored.role &&
    cur.enabledForNewChats === stored.enabledForNewChats
  )
}

async function saveDefaultAuthorsNote(): Promise<void> {
  if (preferencesStore.isDefaultAuthorsNotePatchInFlight()) return
  const note = defaultAuthorsNotePatchFromForm()
  await preferencesStore.patchGlobalDefaultAuthorsNoteToServer({
    content: note.content,
    injectionDepth: note.injectionDepth,
    role: note.role,
    enabledForNewChats: note.enabledForNewChats,
  })
}

async function onDefaultAuthorsNoteContentBlur(): Promise<void> {
  if (preferencesStore.isDefaultAuthorsNotePatchInFlight()) return
  if (defaultAuthorsNoteMatchesStore()) return
  savingDefaultAuthorsNote.value = true
  errorText.value = ''
  try {
    await saveDefaultAuthorsNote()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingDefaultAuthorsNote.value = false
  }
}

watch(defaultAuthorsNoteEnabledForNewChats, async (enabled) => {
  if (preferencesStore.isDefaultAuthorsNotePatchInFlight()) return
  const stored = normalizeDefaultAuthorsNoteTemplate(
    preferencesStore.defaultAuthorsNote,
  )
  if (enabled === stored.enabledForNewChats) return
  savingDefaultAuthorsNote.value = true
  errorText.value = ''
  try {
    await saveDefaultAuthorsNote()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingDefaultAuthorsNote.value = false
  }
})

watch(defaultAuthorsNoteDepth, async (depth) => {
  if (preferencesStore.isDefaultAuthorsNotePatchInFlight()) return
  const stored = normalizeDefaultAuthorsNoteTemplate(
    preferencesStore.defaultAuthorsNote,
  )
  if (depth === stored.injectionDepth) return
  savingDefaultAuthorsNote.value = true
  errorText.value = ''
  try {
    await saveDefaultAuthorsNote()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingDefaultAuthorsNote.value = false
  }
})

watch(defaultAuthorsNoteRole, async (role) => {
  if (preferencesStore.isDefaultAuthorsNotePatchInFlight()) return
  const stored = normalizeDefaultAuthorsNoteTemplate(
    preferencesStore.defaultAuthorsNote,
  )
  if (role === stored.role) return
  savingDefaultAuthorsNote.value = true
  errorText.value = ''
  try {
    await saveDefaultAuthorsNote()
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    syncFromProps()
  } finally {
    savingDefaultAuthorsNote.value = false
  }
})

async function refreshPluginsTabVisibility() {
  const gen = catalogFetchGen
  try {
    const all = await fetchPluginsManage()
    if (gen !== catalogFetchGen) return
    showPluginsTab.value = all.some(
      (p) => p.enabled && p.hasConversationSettings,
    )
    if (activeSection.value === 'plugins' && !showPluginsTab.value) {
      activeSection.value = 'bindings'
    }
  } catch {
    if (gen !== catalogFetchGen) return
    showPluginsTab.value = false
  }
}

function onPluginSettingsError(message: string) {
  errorText.value = message
}

async function loadLorebooks() {
  const gen = catalogFetchGen
  lorebookItemsLoading.value = true
  try {
    const res = await apiFetch('/api/lorebooks')
    if (gen !== catalogFetchGen) return
    if (!res.ok) return
    const raw: unknown = await res.json()
    if (gen !== catalogFetchGen) return
    if (!raw || typeof raw !== 'object') return
    const list = (raw as { lorebooks?: { id?: string; name?: string }[] })
      .lorebooks
    lorebookItems.value = (list ?? [])
      .filter((x) => typeof x.id === 'string' && x.id.trim())
      .map((x) => ({
        id: x.id as string,
        name: typeof x.name === 'string' ? x.name : (x.id as string),
      }))
  } catch {
    /* ignore */
  } finally {
    if (gen === catalogFetchGen) lorebookItemsLoading.value = false
  }
}

async function loadKnowledgeBases() {
  const gen = catalogFetchGen
  knowledgeBaseItemsLoading.value = true
  try {
    const res = await apiFetch('/api/knowledge-bases/summary')
    if (gen !== catalogFetchGen) return
    if (!res.ok) return
    const raw: unknown = await res.json()
    if (gen !== catalogFetchGen) return
    if (!raw || typeof raw !== 'object') return
    const list = (
      raw as { knowledgeBases?: { id?: string; name?: string }[] }
    ).knowledgeBases
    knowledgeBaseItems.value = (list ?? [])
      .filter((x) => typeof x.id === 'string' && x.id.trim())
      .map((x) => ({
        id: x.id as string,
        name: typeof x.name === 'string' ? x.name : (x.id as string),
      }))
  } catch {
    /* ignore */
  } finally {
    if (gen === catalogFetchGen) knowledgeBaseItemsLoading.value = false
  }
}

async function loadCharacters() {
  const gen = catalogFetchGen
  charItemsLoading.value = true
  try {
    const res = await apiFetch('/api/characters?limit=100&offset=0&kind=all')
    if (gen !== catalogFetchGen) return
    if (!res.ok) return
    const j = (await res.json()) as {
      items?: { id?: string; name?: string }[]
    }
    if (gen !== catalogFetchGen) return
    const raw = j.items ?? []
    charItems.value = raw
      .filter((x) => typeof x.id === 'string' && x.id.trim())
      .map((x) => ({
        id: x.id as string,
        name: typeof x.name === 'string' ? x.name : (x.id as string),
      }))
  } catch {
    /* ignore */
  } finally {
    if (gen === catalogFetchGen) charItemsLoading.value = false
  }
}

async function saveChatApiOverride(binding: ConversationChatBinding | null) {
  await patchConversation({
    apiPreset: { chat: binding },
  })
}

async function saveEmbeddingApiOverride(
  patch: ConversationEmbeddingApiSettingsOverride | null,
) {
  await patchConversation({
    embeddingApiSettings: patch,
  })
}

async function onSaveChatApi(binding: ConversationChatBinding | null) {
  savingApiSettings.value = true
  errorText.value = ''
  try {
    await saveChatApiOverride(binding)
    apiChatDraftActive.value = false
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    apiChatDraftActive.value = false
    syncFromProps()
  } finally {
    savingApiSettings.value = false
  }
}

async function onSaveEmbeddingApi(
  patch: ConversationEmbeddingApiSettingsOverride | null,
) {
  savingApiSettings.value = true
  errorText.value = ''
  try {
    await saveEmbeddingApiOverride(patch)
    apiEmbeddingDraftActive.value = false
  } catch (e) {
    errorText.value =
      e instanceof Error ? e.message : t('chat.convSettings.saveFailed')
    apiEmbeddingDraftActive.value = false
    syncFromProps()
  } finally {
    savingApiSettings.value = false
  }
}

async function patchConversation(body: Record<string, unknown>) {
  const cid = props.conversationId
  const run = async () => {
    const res = await apiFetch(`/api/chat/conversations/${cid}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const txt = await res.text()
      throw new Error(txt.slice(0, 200))
    }
    // 切会话后丢弃过期 PATCH，避免旧背景/BGM 写回当前视图
    if (props.conversationId !== cid) return
    const j = (await res.json()) as { index?: Record<string, unknown> }
    if (props.conversationId !== cid) return
    if (j.index) emit('patched', j.index, cid)
  }
  const next = patchChain.then(run, run)
  patchChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

  return {
    dialogOpen,
    recallTestDialogOpen,
    activeSection,
    errorText,
    isSaving,
    displayConversationTitle,
    sectionItems,
    activeSectionHeader,
    open,
    close,
    bindPluginTabApi,
    bindRegexTabApi,
    // bindings
    presetModel,
    characterModel,
    userCharacterModel,
    lorebookModel,
    knowledgeBaseModel,
    backgroundImageFileId,
    bgmFileId,
    presetItems,
    promptsLoaded,
    charItems,
    charItemsLoading,
    lorebookItems,
    lorebookItemsLoading,
    knowledgeBaseItems,
    knowledgeBaseItemsLoading,
    savingPreset,
    savingChars,
    savingUserCharacter,
    savingBackgroundImage,
    savingBgm,
    savingLorebooks,
    savingKnowledgeBases,
    onBackgroundImageFileId,
    onBgmFileId,
    // api
    chatApiUseGlobal,
    embeddingApiUseGlobal,
    apiChatDraftActive,
    apiEmbeddingDraftActive,
    savingApiSettings,
    propsChatBinding,
    propsEmbeddingOverride,
    onChatUseGlobalLocalChange,
    onEmbeddingUseGlobalLocalChange,
    onSaveChatApi,
    onSaveEmbeddingApi,
    // lore
    loreUseGlobal,
    loreRecursiveEnabled,
    loreMaxRecursionDepth,
    loreDepthItems,
    savingLoreSettings,
    // history
    historyUseGlobal,
    historyLimitEnabled,
    historyMaxTurns,
    savingHistorySettings,
    // vector recall
    loreKeywordTopK,
    loreVectorEnabled,
    loreVectorTopK,
    knowledgeUseGlobal,
    knowledgeTopK,
    savingKnowledgeSettings,
    memoryUseGlobal,
    memoryEnabled,
    memoryTopK,
    savingMemorySettings,
    memoryHybridFtsUseGlobal,
    memoryHybridFtsProfile,
    memoryHybridFtsDictVariant,
    memoryHybridFtsSwitchOpen,
    pendingMemoryHybridFtsProfile,
    savingMemoryHybridFts,
    onMemoryHybridFtsProfilePick,
    openMemoryHybridFtsManageDialog,
    onMemoryHybridFtsSwitchConfirm,
    onMemoryHybridFtsSwitchCancel,
    effectiveMemoryEnabled,
    memoryRebuildNeedsAttention,
    memoryRebuildLoading,
    memoryRebuildError,
    memoryRebuildDone,
    memoryRebuildTotal,
    memoryRebuildTurns,
    memoryRebuildLoreEntries,
    memoryRebuildStageLabel,
    memoryRebuildPercent,
    onRebuildMemoryClick,
    // budget
    budgetTrimUseGlobal,
    budgetTrimModel,
    savingBudgetTrimSettings,
    // authors note
    authorsNoteEnabled,
    authorsNoteContent,
    authorsNoteDepth,
    authorsNoteRole,
    canToggleAuthorsNoteEnabled,
    savingAuthorsNote,
    onAuthorsNoteContentBlur,
    defaultAuthorsNoteContent,
    defaultAuthorsNoteDepth,
    defaultAuthorsNoteRole,
    defaultAuthorsNoteEnabledForNewChats,
    savingDefaultAuthorsNote,
    onDefaultAuthorsNoteContentBlur,
    // plugins
    showPluginsTab,
    savingPluginSettings,
    onPluginSettingsError,
  }
}
