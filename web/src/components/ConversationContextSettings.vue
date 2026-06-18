<script setup lang="ts">
import { useMemoryRebuild } from '@/composables/useMemoryRebuild'
import { usePromptsStore } from '@/stores/prompts'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  AUTHORS_NOTE_MAX_DEPTH,
  normalizeAuthorsNote,
  normalizeDefaultAuthorsNoteTemplate,
  type AuthorsNoteRole,
  type AuthorsNoteSettings,
  type DefaultAuthorsNoteTemplate,
} from '@/utils/authors-note-settings'
import { usePreferencesStore } from '@/stores/preferences'
import BudgetTrimSettingsPanel from '@/components/settings/BudgetTrimSettingsPanel.vue'
import ConversationApiSettingsPanel from '@/components/settings/ConversationApiSettingsPanel.vue'
import ConversationPluginSettingsPanel from '@/components/settings/ConversationPluginSettingsPanel.vue'
import ConversationRegexApplyPanel from '@/components/settings/ConversationRegexApplyPanel.vue'
import ConversationRecallTestDialog from '@/components/settings/ConversationRecallTestDialog.vue'
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
  hybridFtsSpecsMatch,
  parseHybridFtsSpec,
} from '@/utils/hybrid-fts-settings'

const props = defineProps<{
  conversationId: string
  /** 对话标题（页脚展示；空则用「新对话」） */
  conversationTitle?: string | null
  /** `null` / 未绑定：使用全局激活预设 */
  initialPromptPresetId?: string | null
  initialCharacterIds: string[]
  initialLorebookIds: string[]
  /** 未覆盖时继承全局 */
  initialLorebookSettingsUseGlobal?: boolean
  globalLoreRecursiveEnabled?: boolean
  globalLoreMaxRecursionDepth?: number
  initialLorebookRecursiveEnabled?: boolean
  initialLorebookMaxRecursionDepth?: number
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
  /** 全局 Embedding 模型（用于提示是否需要重建） */
  globalEmbeddingModel?: string
  /** 本会话已索引的 Embedding 模型 */
  conversationMemoryEmbeddingModel?: string | null
  /** 本会话已索引的 Hybrid FTS spec（如 zh-jieba:default） */
  conversationMemoryHybridFtsSpec?: string | null
  /** 全局 Hybrid FTS spec */
  globalHybridFtsSpec?: string
  /** 会话内 `{{user}}` 展示名；空表示用默认「用户」 */
  initialUserName?: string | null
  /** 用户 persona 角色卡 id */
  initialUserCharacterId?: string | null
  initialAuthorsNote?: AuthorsNoteSettings
  /** 会话 index.apiPreset（含 chat 覆盖） */
  initialApiPreset?: unknown
  initialChatApiUseGlobal?: boolean
  initialEmbeddingApiUseGlobal?: boolean
  initialEmbeddingApiSettings?: ConversationEmbeddingApiSettingsOverride
  globalEmbeddingDimensions?: number | null
}>()

const emit = defineEmits<{
  (e: 'patched', index: Record<string, unknown>): void
  (e: 'memoryRebuilt', embeddingModel: string): void
  (e: 'regexApplied'): void
}>()

type SettingsSection =
  | 'bindings'
  | 'api'
  | 'lore'
  | 'context'
  | 'budgetTrim'
  | 'authorsNote'
  | 'regexApply'
  | 'plugins'

const { t } = useI18n()
const promptsStore = usePromptsStore()
const { presets, loaded: promptsLoaded } = storeToRefs(promptsStore)

const dialogOpen = ref(false)
const recallTestDialogOpen = ref(false)
const activeSection = ref<SettingsSection>('bindings')

const INHERIT_VALUE = ''

const presetModel = ref<string>(INHERIT_VALUE)
const characterModel = ref<string[]>([])
const userCharacterModel = ref<string | null>(null)

const savingPreset = ref(false)
const savingChars = ref(false)
const savingUserCharacter = ref(false)
const savingLorebooks = ref(false)
const savingLoreSettings = ref(false)
const savingHistorySettings = ref(false)
const savingMemorySettings = ref(false)
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
const loreUseGlobal = ref(true)
const loreRecursiveEnabled = ref(false)
type LoreRecursionDepth = 0 | 1 | 2 | 3
const loreMaxRecursionDepth = ref<LoreRecursionDepth>(2)

const loreDepthItems: LoreRecursionDepth[] = [0, 1, 2, 3]

/** 提示词宏名；勿写入 i18n（vue-i18n 会将 `{{` 当作占位符） */
const PROMPT_USER_MACRO = '{{user}}'

const historyUseGlobal = ref(true)
const historyLimitEnabled = ref(false)
const historyMaxTurns = ref(20)

const memoryUseGlobal = ref(true)
const memoryEnabled = ref(false)
const memoryTopK = ref(4)

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
  percent: memoryRebuildPercent,
  rebuild: rebuildMemoryIndex,
} = useMemoryRebuild(() => props.conversationId)

const effectiveMemoryEnabled = computed(() =>
  memoryUseGlobal.value
    ? props.globalMemoryEnabled === true
    : memoryEnabled.value,
)

const memoryRebuildNeedsAttention = computed(() => {
  if (!effectiveMemoryEnabled.value) return false
  const global = props.globalEmbeddingModel?.trim() ?? ''
  if (!global) return false
  const stored = props.conversationMemoryEmbeddingModel?.trim() ?? ''
  if (!stored) return false
  const globalFts = props.globalHybridFtsSpec?.trim() ?? 'zh-ngram'
  const storedFts = props.conversationMemoryHybridFtsSpec?.trim() ?? null
  const ftsMismatch = !hybridFtsSpecsMatch(storedFts, parseHybridFtsSpec(globalFts))
  return stored !== global || ftsMismatch
})

async function onRebuildMemoryClick() {
  const model = await rebuildMemoryIndex()
  if (model) emit('memoryRebuilt', model)
}

interface CharItem {
  id: string
  name: string
}

interface LorebookItem {
  id: string
  name: string
}

const charItems = ref<CharItem[]>([])
const charItemsLoading = ref(false)
const lorebookItems = ref<LorebookItem[]>([])
const lorebookItemsLoading = ref(false)
const showPluginsTab = ref(false)
const savingPluginSettings = ref(false)
const pluginSettingsPanelRef = ref<InstanceType<
  typeof ConversationPluginSettingsPanel
> | null>(null)
const regexApplyPanelRef = ref<InstanceType<
  typeof ConversationRegexApplyPanel
> | null>(null)
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
      id: 'lore',
      title: t('chat.convSettings.tabLore'),
      icon: 'mdi-book-open-page-variant-outline',
    },
    {
      id: 'context',
      title: t('chat.convSettings.tabContext'),
      icon: 'mdi-tune-variant',
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
    { titleKey: string; hintKey: string }
  > = {
    bindings: {
      titleKey: 'tabBindings',
      hintKey: 'tabBindingsHint',
    },
    api: { titleKey: 'tabApi', hintKey: 'tabApiHint' },
    lore: { titleKey: 'tabLore', hintKey: 'tabLoreHint' },
    context: { titleKey: 'tabContext', hintKey: 'tabContextHint' },
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
  return {
    title: t(`chat.convSettings.${keys.titleKey}`),
    hint: t(`chat.convSettings.${keys.hintKey}`),
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
    savingLorebooks.value ||
    savingLoreSettings.value ||
    savingHistorySettings.value ||
    savingMemorySettings.value ||
    savingBudgetTrimSettings.value ||
    savingAuthorsNote.value ||
    savingDefaultAuthorsNote.value ||
    savingApiSettings.value ||
    savingPluginSettings.value,
)

function open(section?: SettingsSection): void {
  syncFromProps()
  void refreshPluginsTabVisibility()
  if (section === 'plugins' && !showPluginsTab.value) {
    activeSection.value = 'bindings'
  } else {
    activeSection.value = section ?? 'bindings'
  }
  dialogOpen.value = true
  if (activeSection.value === 'plugins') {
    void pluginSettingsPanelRef.value?.reload()
  }
  if (activeSection.value === 'regexApply') {
    void regexApplyPanelRef.value?.reload()
  }
}

function close(): void {
  dialogOpen.value = false
}

watch(activeSection, (section) => {
  if (section !== 'plugins') {
    pluginSettingsPanelRef.value?.backToList()
  }
  if (section === 'regexApply') {
    void regexApplyPanelRef.value?.reload()
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

defineExpose({ open })

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
  lorebookModel.value = [...props.initialLorebookIds]
  loreUseGlobal.value = propsLoreUseGlobal()
  if (loreUseGlobal.value) {
    loreRecursiveEnabled.value = propsGlobalLoreRecursiveEnabled()
    loreMaxRecursionDepth.value = propsGlobalLoreMaxRecursionDepth()
  } else {
    loreRecursiveEnabled.value = propsLoreRecursiveEnabled()
    loreMaxRecursionDepth.value = propsLoreMaxRecursionDepth()
  }
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
    props.initialLorebookSettingsUseGlobal,
    props.globalLoreRecursiveEnabled,
    props.globalLoreMaxRecursionDepth,
    props.initialLorebookRecursiveEnabled,
    props.initialLorebookMaxRecursionDepth,
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
    props.initialBudgetTrimSettingsUseGlobal,
    props.globalBudgetTrimSettings,
    props.initialBudgetTrimSettings,
    props.initialUserName,
    props.initialUserCharacterId,
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
      await patchConversation({ characterIds: [...ids] })
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

watch(loreUseGlobal, async (useGlobal) => {
  if (useGlobal === propsLoreUseGlobal()) return
  savingLoreSettings.value = true
  errorText.value = ''
  try {
    if (useGlobal) {
      await patchConversation({ lorebookSettings: null })
    } else {
      await patchConversation({
        lorebookSettings: {
          recursiveEnabled: loreRecursiveEnabled.value,
          maxRecursionDepth: loreMaxRecursionDepth.value,
        },
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
    lorebookSettings: {
      recursiveEnabled: loreRecursiveEnabled.value,
      maxRecursionDepth: loreMaxRecursionDepth.value,
    },
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
  try {
    const all = await fetchPluginsManage()
    showPluginsTab.value = all.some(
      (p) => p.enabled && p.hasConversationSettings,
    )
    if (activeSection.value === 'plugins' && !showPluginsTab.value) {
      activeSection.value = 'bindings'
    }
  } catch {
    showPluginsTab.value = false
  }
}

function onPluginSettingsError(message: string) {
  errorText.value = message
}

onMounted(() => {
  syncFromProps()
  void loadCharacters()
  void loadLorebooks()
  void refreshPluginsTabVisibility()
})

async function loadLorebooks() {
  lorebookItemsLoading.value = true
  try {
    const res = await fetch('/api/lorebooks')
    if (!res.ok) return
    const raw: unknown = await res.json()
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
    lorebookItemsLoading.value = false
  }
}

async function loadCharacters() {
  charItemsLoading.value = true
  try {
    const res = await fetch('/api/characters?limit=100&offset=0')
    if (!res.ok) return
    const j = (await res.json()) as {
      items?: { id?: string; name?: string }[]
    }
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
    charItemsLoading.value = false
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
  const res = await fetch(`/api/chat/conversations/${props.conversationId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const txt = await res.text()
    throw new Error(txt.slice(0, 200))
  }
  const j = (await res.json()) as { index?: Record<string, unknown> }
  if (j.index) emit('patched', j.index)
}
</script>

<template>
  <v-dialog
    v-model="dialogOpen"
    scrollable
    content-class="app-config-dialog-surface"
  >
    <v-card class="conv-settings-dialog">
      <v-card-title class="conv-settings-dialog__title">
        <div class="conv-settings-dialog__title-row">
          <span class="conv-settings-dialog__main-title text-body-1 font-weight-medium">
            {{ $t('chat.convSettings.title') }}
          </span>
          <div
            class="conv-settings-dialog__title-sep"
            aria-hidden="true"
          />
          <div class="conv-settings-dialog__section-head min-w-0">
            <div class="conv-settings-dialog__section-title">
              {{ activeSectionHeader.title }}
            </div>
            <p class="conv-settings-dialog__section-hint mb-0">
              {{ activeSectionHeader.hint }}
            </p>
          </div>
          <v-spacer />
          <v-progress-circular
            v-if="isSaving"
            indeterminate
            size="18"
            width="2"
            class="mr-2 flex-shrink-0"
          />
          <v-btn
            icon="mdi-close"
            variant="text"
            density="comfortable"
            class="flex-shrink-0"
            :aria-label="$t('chat.turnPromptClose')"
            @click="close"
          />
        </div>
      </v-card-title>

      <v-divider />

      <v-card-text class="pa-0 conv-settings-dialog__body">
        <v-alert
          v-if="errorText"
          type="error"
          density="compact"
          variant="tonal"
          class="ma-4 mb-0"
          closable
          @click:close="errorText = ''"
        >
          {{ errorText }}
        </v-alert>

        <div class="conv-settings-layout">
          <nav class="conv-settings-nav">
            <v-list
              density="compact"
              nav
              class="conv-settings-nav__list"
            >
              <v-list-item
                v-for="item in sectionItems"
                :key="item.id"
                :title="item.title"
                :prepend-icon="item.icon"
                :active="activeSection === item.id"
                rounded="lg"
                color="primary"
                @click="activeSection = item.id"
              />
            </v-list>
          </nav>

          <div class="conv-settings-panel">
            <div
              v-show="activeSection === 'bindings'"
              class="conv-settings-section"
            >
              <div class="conv-settings-field">
                <v-select
                  v-model="presetModel"
                  :items="presetItems"
                  item-title="title"
                  item-value="value"
                  :label="$t('chat.convSettings.promptPreset')"
                  density="comfortable"
                  variant="outlined"
                  hide-details="auto"
                  :loading="savingPreset || !promptsLoaded"
                  :disabled="!promptsLoaded"
                />
              </div>

              <div class="conv-settings-field">
                <v-select
                  v-model="userCharacterModel"
                  :items="charItems"
                  item-title="name"
                  item-value="id"
                  :label="$t('chat.convSettings.userCharacter')"
                  density="comfortable"
                  variant="outlined"
                  hide-details="auto"
                  clearable
                  :loading="charItemsLoading || savingUserCharacter"
                />
                <p class="conv-settings-field__hint">
                  {{ $t('chat.convSettings.userCharacterHint') }}
                </p>
                <p
                  v-if="initialUserName"
                  class="conv-settings-field__hint text-medium-emphasis"
                >
                  {{ $t('chat.convSettings.userNameCurrent', { name: initialUserName }) }}
                  <code class="user-macro-tag">{{ PROMPT_USER_MACRO }}</code>
                </p>
              </div>

              <div class="conv-settings-field">
                <v-select
                  v-model="characterModel"
                  :items="charItems"
                  item-title="name"
                  item-value="id"
                  :label="$t('chat.convSettings.characters')"
                  density="comfortable"
                  variant="outlined"
                  multiple
                  chips
                  closable-chips
                  hide-details="auto"
                  :loading="charItemsLoading || savingChars"
                />
                <p class="conv-settings-field__hint">
                  {{ $t('chat.convSettings.charactersHint') }}
                </p>
              </div>

              <div class="conv-settings-field">
                <v-select
                  v-model="lorebookModel"
                  :items="lorebookItems"
                  item-title="name"
                  item-value="id"
                  :label="$t('chat.convSettings.lorebooks')"
                  density="comfortable"
                  variant="outlined"
                  multiple
                  chips
                  closable-chips
                  hide-details="auto"
                  :loading="lorebookItemsLoading || savingLorebooks"
                />
                <p class="conv-settings-field__hint">
                  {{ $t('chat.convSettings.lorebooksHint') }}
                </p>
              </div>
            </div>

            <div
              v-show="activeSection === 'api'"
              class="conv-settings-section"
            >
              <ConversationApiSettingsPanel
                :chat-use-global="chatApiUseGlobal"
                :chat-binding="propsChatBinding()"
                :embedding-use-global="embeddingApiUseGlobal"
                :embedding-override="propsEmbeddingOverride()"
                :global-embedding-model="props.globalEmbeddingModel ?? ''"
                :global-embedding-dimensions="props.globalEmbeddingDimensions ?? null"
                :allow-prop-sync="!apiChatDraftActive && !apiEmbeddingDraftActive && !savingApiSettings"
                :disabled="savingApiSettings"
                @update:chat-use-global="onChatUseGlobalLocalChange"
                @update:embedding-use-global="onEmbeddingUseGlobalLocalChange"
                @save-chat="onSaveChatApi"
                @save-embedding="onSaveEmbeddingApi"
              />
            </div>

            <div
              v-show="activeSection === 'lore'"
              class="conv-settings-section"
            >
              <div class="conv-settings-field">
                <v-switch
                  v-model="loreUseGlobal"
                  :label="$t('chat.convSettings.loreUseGlobal')"
                  density="comfortable"
                  hide-details
                  color="primary"
                  :loading="savingLoreSettings"
                  :disabled="savingLoreSettings"
                />
                <p
                  v-if="loreUseGlobal"
                  class="conv-settings-field__hint"
                >
                  {{ $t('chat.convSettings.loreInheritGlobalHint') }}
                </p>
              </div>

              <div class="conv-settings-field">
                <v-switch
                  v-model="loreRecursiveEnabled"
                  :label="$t('chat.convSettings.loreRecursiveEnabled')"
                  density="comfortable"
                  hide-details
                  color="primary"
                  :loading="savingLoreSettings"
                  :disabled="loreUseGlobal || savingLoreSettings"
                />
                <p class="conv-settings-field__hint">
                  {{ $t('chat.convSettings.loreRecursiveHint') }}
                </p>
              </div>

              <div class="conv-settings-field">
                <v-select
                  v-model="loreMaxRecursionDepth"
                  :items="[...loreDepthItems]"
                  :label="$t('chat.convSettings.loreMaxRecursionDepth')"
                  density="comfortable"
                  variant="outlined"
                  hide-details="auto"
                  :disabled="loreUseGlobal || !loreRecursiveEnabled || savingLoreSettings"
                  :loading="savingLoreSettings"
                />
                <p
                  v-if="loreRecursiveEnabled"
                  class="conv-settings-field__hint"
                >
                  {{ $t('chat.convSettings.loreMaxRecursionDepthHint') }}
                </p>
              </div>
            </div>

            <div
              v-show="activeSection === 'context'"
              class="conv-settings-section"
            >
              <div class="conv-settings-subsection">
                <h4 class="conv-settings-subsection__title">
                  {{ $t('chat.convSettings.sectionHistory') }}
                </h4>
                <div class="conv-settings-field">
                  <v-switch
                    v-model="historyUseGlobal"
                    :label="$t('chat.convSettings.historyUseGlobal')"
                    density="comfortable"
                    hide-details
                    color="primary"
                    :loading="savingHistorySettings"
                    :disabled="savingHistorySettings"
                  />
                  <p
                    v-if="historyUseGlobal"
                    class="conv-settings-field__hint"
                  >
                    {{ $t('chat.convSettings.historyInheritGlobalHint') }}
                  </p>
                </div>
                <div class="conv-settings-field">
                  <v-switch
                    v-model="historyLimitEnabled"
                    :label="$t('chat.convSettings.historyLimitEnabled')"
                    density="comfortable"
                    hide-details
                    color="primary"
                    :loading="savingHistorySettings"
                    :disabled="historyUseGlobal || savingHistorySettings"
                  />
                  <p class="conv-settings-field__hint">
                    {{ $t('chat.convSettings.historyLimitHint') }}
                  </p>
                </div>
                <div class="conv-settings-field">
                  <v-text-field
                    v-model.number="historyMaxTurns"
                    type="number"
                    min="1"
                    max="200"
                    step="1"
                    :label="$t('chat.convSettings.historyMaxTurns')"
                    density="comfortable"
                    variant="outlined"
                    hide-details="auto"
                    :disabled="historyUseGlobal || !historyLimitEnabled || savingHistorySettings"
                    :loading="savingHistorySettings"
                  />
                  <p
                    v-if="historyLimitEnabled"
                    class="conv-settings-field__hint"
                  >
                    {{ $t('chat.convSettings.historyMaxTurnsHint') }}
                  </p>
                </div>
              </div>

              <v-divider class="my-4" />

              <div class="conv-settings-subsection">
                <h4 class="conv-settings-subsection__title">
                  {{ $t('chat.convSettings.sectionMemory') }}
                </h4>
                <div class="conv-settings-field">
                  <v-switch
                    v-model="memoryUseGlobal"
                    :label="$t('chat.convSettings.memoryUseGlobal')"
                    density="comfortable"
                    hide-details
                    color="primary"
                    :loading="savingMemorySettings"
                    :disabled="savingMemorySettings"
                  />
                  <p
                    v-if="memoryUseGlobal"
                    class="conv-settings-field__hint"
                  >
                    {{ $t('chat.convSettings.memoryInheritGlobalHint') }}
                  </p>
                </div>
                <div class="conv-settings-field">
                  <v-switch
                    v-model="memoryEnabled"
                    :label="$t('chat.convSettings.memoryEnabled')"
                    density="comfortable"
                    hide-details
                    color="primary"
                    :loading="savingMemorySettings"
                    :disabled="memoryUseGlobal || savingMemorySettings"
                  />
                  <p class="conv-settings-field__hint">
                    {{ $t('chat.convSettings.memoryEnabledHint') }}
                  </p>
                </div>
                <div class="conv-settings-field">
                  <v-text-field
                    v-model.number="memoryTopK"
                    type="number"
                    min="1"
                    max="20"
                    step="1"
                    :label="$t('chat.convSettings.memoryTopK')"
                    density="comfortable"
                    variant="outlined"
                    hide-details="auto"
                    :disabled="memoryUseGlobal || !memoryEnabled || savingMemorySettings"
                    :loading="savingMemorySettings"
                  />
                  <p
                    v-if="memoryEnabled"
                    class="conv-settings-field__hint"
                  >
                    {{ $t('chat.convSettings.memoryTopKHint') }}
                  </p>
                </div>
                <div
                  v-if="effectiveMemoryEnabled"
                  class="conv-settings-field"
                >
                  <v-btn
                    variant="outlined"
                    color="primary"
                    prepend-icon="mdi-database-refresh-outline"
                    :loading="memoryRebuildLoading"
                    :disabled="memoryRebuildLoading"
                    @click="onRebuildMemoryClick"
                  >
                    {{ $t('chat.convSettings.memoryRebuildButton') }}
                  </v-btn>
                  <p
                    class="conv-settings-field__hint"
                    :class="{ 'text-warning': memoryRebuildNeedsAttention }"
                  >
                    {{
                      memoryRebuildNeedsAttention
                        ? $t('chat.convSettings.memoryRebuildMismatchHint')
                        : $t('chat.convSettings.memoryRebuildHint')
                    }}
                  </p>
                  <div
                    v-if="memoryRebuildLoading"
                    class="mt-2"
                  >
                    <p class="text-caption text-medium-emphasis mb-1">
                      {{
                        $t('chatConversation.memoryRebuildProgress', {
                          done: memoryRebuildDone,
                          total: memoryRebuildTotal,
                        })
                      }}
                    </p>
                    <p
                      v-if="memoryRebuildTotal > 0"
                      class="text-caption text-medium-emphasis mb-1"
                    >
                      {{
                        $t('chatConversation.memoryRebuildProgressDetail', {
                          turns: memoryRebuildTurns,
                          loreEntries: memoryRebuildLoreEntries,
                        })
                      }}
                    </p>
                    <v-progress-linear
                      :model-value="memoryRebuildTotal > 0 ? memoryRebuildPercent : undefined"
                      :indeterminate="memoryRebuildTotal < 1"
                      height="6"
                      rounded
                      color="primary"
                    />
                  </div>
                  <v-alert
                    v-if="memoryRebuildError"
                    type="error"
                    variant="tonal"
                    density="compact"
                    class="mt-2"
                  >
                    {{ memoryRebuildError }}
                  </v-alert>
                </div>
              </div>

              <v-divider class="my-4" />

              <div class="conv-settings-subsection">
                <h4 class="conv-settings-subsection__title">
                  {{ $t('chat.convSettings.sectionRecallTest') }}
                </h4>
                <p class="conv-settings-field__hint mb-3">
                  {{ $t('chat.convSettings.recallTestButtonHint') }}
                </p>
                <v-btn
                  variant="outlined"
                  color="primary"
                  prepend-icon="mdi-magnify-scan"
                  @click="recallTestDialogOpen = true"
                >
                  {{ $t('chat.convSettings.recallTestButton') }}
                </v-btn>
              </div>
            </div>

            <div
              v-show="activeSection === 'budgetTrim'"
              class="conv-settings-section"
            >
              <div class="conv-settings-field">
                <v-switch
                  v-model="budgetTrimUseGlobal"
                  :label="$t('chat.convSettings.budgetTrimUseGlobal')"
                  density="comfortable"
                  hide-details
                  color="primary"
                  :loading="savingBudgetTrimSettings"
                  :disabled="savingBudgetTrimSettings"
                />
                <p
                  v-if="budgetTrimUseGlobal"
                  class="conv-settings-field__hint"
                >
                  {{ $t('chat.convSettings.budgetTrimInheritGlobalHint') }}
                </p>
              </div>
              <BudgetTrimSettingsPanel
                v-model="budgetTrimModel"
                :disabled="budgetTrimUseGlobal || savingBudgetTrimSettings"
              />
            </div>

            <div
              v-show="activeSection === 'authorsNote'"
              class="conv-settings-section"
            >
              <p class="text-subtitle-2 font-weight-medium mb-2">
                {{ $t('chat.convSettings.authorsNoteSessionHeading') }}
              </p>
              <div class="conv-settings-field">
                <v-textarea
                  v-model="authorsNoteContent"
                  :label="$t('chat.convSettings.authorsNoteContent')"
                  rows="6"
                  auto-grow
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  :loading="savingAuthorsNote"
                  @blur="onAuthorsNoteContentBlur"
                />
                <p class="conv-settings-field__hint">
                  {{ $t('chat.convSettings.authorsNoteContentHint') }}
                </p>
              </div>

              <div class="conv-settings-field">
                <v-switch
                  v-model="authorsNoteEnabled"
                  :label="$t('chat.convSettings.authorsNoteEnabled')"
                  density="comfortable"
                  hide-details
                  color="primary"
                  :loading="savingAuthorsNote"
                  :disabled="!canToggleAuthorsNoteEnabled || savingAuthorsNote"
                />
                <p class="conv-settings-field__hint">
                  {{ $t('chat.convSettings.authorsNoteEnabledHint') }}
                </p>
              </div>

              <div class="conv-settings-field">
                <v-text-field
                  v-model.number="authorsNoteDepth"
                  type="number"
                  min="0"
                  :max="AUTHORS_NOTE_MAX_DEPTH"
                  step="1"
                  :label="$t('chat.convSettings.authorsNoteDepth')"
                  density="comfortable"
                  variant="outlined"
                  hide-details="auto"
                  :loading="savingAuthorsNote"
                  :disabled="savingAuthorsNote"
                />
                <p class="conv-settings-field__hint">
                  {{ $t('chat.convSettings.authorsNoteDepthHint') }}
                </p>
              </div>

              <div class="conv-settings-field">
                <v-select
                  v-model="authorsNoteRole"
                  :items="[
                    { title: $t('chat.convSettings.authorsNoteRoleSystem'), value: 'system' },
                    { title: $t('chat.convSettings.authorsNoteRoleUser'), value: 'user' },
                  ]"
                  item-title="title"
                  item-value="value"
                  :label="$t('chat.convSettings.authorsNoteRole')"
                  density="comfortable"
                  variant="outlined"
                  hide-details="auto"
                  :loading="savingAuthorsNote"
                  :disabled="savingAuthorsNote"
                />
              </div>

              <v-divider class="my-4" />

              <p class="text-subtitle-2 font-weight-medium mb-1">
                {{ $t('chat.convSettings.defaultAuthorsNoteHeading') }}
              </p>
              <p class="text-caption text-medium-emphasis mb-3">
                {{ $t('chat.convSettings.defaultAuthorsNoteIntro') }}
              </p>

              <div class="conv-settings-field">
                <v-textarea
                  v-model="defaultAuthorsNoteContent"
                  :label="$t('chat.convSettings.defaultAuthorsNoteContent')"
                  rows="5"
                  auto-grow
                  variant="outlined"
                  density="comfortable"
                  hide-details="auto"
                  :loading="savingDefaultAuthorsNote"
                  @blur="onDefaultAuthorsNoteContentBlur"
                />
                <p class="conv-settings-field__hint">
                  {{ $t('chat.convSettings.defaultAuthorsNoteContentHint') }}
                </p>
              </div>

              <div class="conv-settings-field">
                <v-switch
                  v-model="defaultAuthorsNoteEnabledForNewChats"
                  :label="$t('chat.convSettings.defaultAuthorsNoteEnabledForNewChats')"
                  density="comfortable"
                  hide-details
                  color="primary"
                  :loading="savingDefaultAuthorsNote"
                  :disabled="savingDefaultAuthorsNote"
                />
                <p class="conv-settings-field__hint">
                  {{ $t('chat.convSettings.defaultAuthorsNoteEnabledForNewChatsHint') }}
                </p>
              </div>

              <div class="conv-settings-field">
                <v-text-field
                  v-model.number="defaultAuthorsNoteDepth"
                  type="number"
                  min="0"
                  :max="AUTHORS_NOTE_MAX_DEPTH"
                  step="1"
                  :label="$t('chat.convSettings.authorsNoteDepth')"
                  density="comfortable"
                  variant="outlined"
                  hide-details="auto"
                  :loading="savingDefaultAuthorsNote"
                  :disabled="savingDefaultAuthorsNote"
                />
                <p class="conv-settings-field__hint">
                  {{ $t('chat.convSettings.defaultAuthorsNoteDepthHint') }}
                </p>
              </div>

              <div class="conv-settings-field">
                <v-select
                  v-model="defaultAuthorsNoteRole"
                  :items="[
                    { title: $t('chat.convSettings.authorsNoteRoleSystem'), value: 'system' },
                    { title: $t('chat.convSettings.authorsNoteRoleUser'), value: 'user' },
                  ]"
                  item-title="title"
                  item-value="value"
                  :label="$t('chat.convSettings.authorsNoteRole')"
                  density="comfortable"
                  variant="outlined"
                  hide-details="auto"
                  :loading="savingDefaultAuthorsNote"
                  :disabled="savingDefaultAuthorsNote"
                />
              </div>
            </div>

            <div
              v-show="activeSection === 'regexApply'"
              class="conv-settings-section"
            >
              <ConversationRegexApplyPanel
                ref="regexApplyPanelRef"
                :conversation-id="conversationId"
                @applied="emit('regexApplied')"
              />
            </div>

            <div
              v-show="activeSection === 'plugins'"
              class="conv-settings-section"
            >
              <ConversationPluginSettingsPanel
                ref="pluginSettingsPanelRef"
                :conversation-id="conversationId"
                @saving-change="savingPluginSettings = $event"
                @error="onPluginSettingsError"
              />
            </div>
          </div>
        </div>
      </v-card-text>

      <v-divider />

      <v-card-actions class="px-4 py-3 conv-settings-dialog__footer">
        <div class="conv-settings-dialog__footer-meta">
          <div
            class="conv-settings-dialog__footer-title text-body-2 font-weight-medium"
            :title="displayConversationTitle"
          >
            {{ displayConversationTitle }}
          </div>
          <div class="text-caption text-medium-emphasis conv-settings-dialog__footer-sub">
            <code class="conv-settings-dialog__footer-id">{{ conversationId }}</code>
            <span class="conv-settings-dialog__footer-sep">·</span>
            {{ $t('chat.convSettings.autoSaveHint') }}
          </div>
        </div>
        <v-spacer />
        <v-btn
          variant="flat"
          color="primary"
          @click="close"
        >
          {{ $t('chat.turnPromptClose') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <ConversationRecallTestDialog
    v-model="recallTestDialogOpen"
    :conversation-id="conversationId"
  />
</template>

<style scoped>
.conv-settings-dialog {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
  max-height: 100%;
}

.conv-settings-dialog__title {
  padding-block: 0.75rem;
  flex-shrink: 0;
}

.conv-settings-dialog__title-row {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  width: 100%;
  min-width: 0;
}

.conv-settings-dialog__main-title {
  flex-shrink: 0;
}

.conv-settings-dialog__title-sep {
  flex-shrink: 0;
  align-self: stretch;
  width: 0.0625rem;
  min-height: 2.25rem;
  background: rgba(var(--v-theme-on-surface), 0.14);
}

.conv-settings-dialog__section-head {
  flex: 1 1 auto;
  min-width: 0;
}

.conv-settings-dialog__section-title {
  font-size: 0.875rem;
  font-weight: 600;
  line-height: 1.35;
}

.conv-settings-dialog__section-hint {
  margin-top: 0.125rem;
  font-size: 0.75rem;
  line-height: 1.4;
  font-weight: 400;
  color: rgba(var(--v-theme-on-surface), 0.62);
}

.conv-settings-dialog__footer {
  align-items: center;
  gap: 0.75rem;
}

.conv-settings-dialog__footer-meta {
  min-width: 0;
  max-width: min(100%, 28rem);
}

.conv-settings-dialog__footer-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-settings-dialog__footer-sub {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
  margin-top: 0.125rem;
  line-height: 1.4;
}

.conv-settings-dialog__footer-id {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  padding: 0.0625rem 0.25rem;
  border-radius: 0.25rem;
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.conv-settings-dialog__footer-sep {
  opacity: 0.55;
}

.conv-settings-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.conv-settings-layout {
  display: flex;
  align-items: stretch;
  flex: 1 1 auto;
  min-height: 0;
}

.conv-settings-nav {
  flex: 0 0 11.5rem;
  border-inline-end: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
  background: rgba(var(--v-theme-on-surface), 0.02);
  padding: 0.5rem;
}

.conv-settings-nav__list {
  padding: 0;
  background: transparent;
}

.conv-settings-panel {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow: auto;
  padding: 1rem 1.125rem 1.25rem;
}

.conv-settings-subsection__title {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(var(--v-theme-on-surface), 0.78);
}

.conv-settings-field + .conv-settings-field {
  margin-top: 0.875rem;
}

.conv-settings-field__hint {
  margin: 0.375rem 0 0;
  font-size: 0.75rem;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.58);
}

.user-macro-tag {
  font-family: ui-monospace, monospace;
  font-size: 0.85em;
  padding: 0 0.15em;
}

@media (max-width: 36rem) {
  .conv-settings-layout {
    flex-direction: column;
    min-height: 0;
  }

  .conv-settings-nav {
    flex: 0 0 auto;
    border-inline-end: none;
    border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
    padding: 0.375rem 0.5rem;
  }

  .conv-settings-nav__list {
    display: flex;
    flex-direction: row;
    overflow-x: auto;
    gap: 0.25rem;
  }

  .conv-settings-nav__list :deep(.v-list-item) {
    flex: 0 0 auto;
    min-width: max-content;
  }

  .conv-settings-panel {
    max-height: none;
  }
}
</style>
