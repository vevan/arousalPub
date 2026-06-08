<script setup lang="ts">
import ApiModelPickerDialog from '@/components/settings/ApiModelPickerDialog.vue'
import FeatureBindingsCard from '@/components/settings/FeatureBindingsCard.vue'
import { intlLocaleTag } from '@/i18n/locale'
import { useApiKeysStore, type ApiKeyEntry } from '@/stores/apiKeys'
import { useAuthStore } from '@/stores/auth'
import { useConnectionStore } from '@/stores/connection'
import { useLocaleStore } from '@/stores/locale'
import { usePromptsStore } from '@/stores/prompts'
import {
  exportDocHasApiKey,
  exportDocHasBaseUrl,
  exportDocHasLinkedPreset,
  parseApiPresetExportDoc,
  type ApiPresetExportDoc,
} from '@/utils/api-preset-export'
import {
  formatDryBreakersForTextarea,
  parseDryBreakersFromTextarea,
} from '@/utils/dry-sampler'
import type { ApiConfigReference } from '@/utils/api-config-references'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref<'success' | 'error' | 'warning'>('success')

const connectionTestLoading = ref(false)
const referencesDialogOpen = ref(false)
const referencesDialogTitle = ref('')
const referencesDialogItems = ref<string[]>([])

type TestResultDialogKind = 'success' | 'partial' | 'failed'
const testResultDialogOpen = ref(false)
const testResultDialogKind = ref<TestResultDialogKind>('success')
const testResultDialog = ref<{
  modelsCount?: number
  modelsMs?: number
  chatModel?: string
  chatMs?: number
  totalMs?: number
  reply?: string
  replyWarning?: 'truncated'
  error?: string
  detail?: string
} | null>(null)

function openTestResultDialog(
  kind: TestResultDialogKind,
  data: NonNullable<typeof testResultDialog.value>,
) {
  testResultDialogKind.value = kind
  testResultDialog.value = data
  testResultDialogOpen.value = true
}

function formatReferenceLine(ref: ApiConfigReference): string {
  if (ref.kind === 'conversation_api_preset') {
    return t('conn.refConversation', {
      title: ref.conversationTitle ?? ref.conversationId ?? '—',
      id: ref.conversationId ?? '—',
      path: ref.path ?? '—',
    })
  }
  if (ref.kind === 'api_preset_api_key') {
    return t('conn.refPresetKey', {
      alias: ref.presetAlias ?? ref.presetId ?? '—',
    })
  }
  if (ref.kind === 'embedding_api_key') {
    return t('conn.refEmbeddingKey')
  }
  if (ref.kind === 'global_feature_binding') {
    return t('conn.refGlobalBinding', { path: ref.path ?? '—' })
  }
  return ref.kind
}

function openReferencesDialog(title: string, refs: ApiConfigReference[]) {
  referencesDialogTitle.value = title
  referencesDialogItems.value = refs.map(formatReferenceLine)
  referencesDialogOpen.value = true
}

const conn = useConnectionStore()
const prompts = usePromptsStore()
const apiKeysStore = useApiKeysStore()
const localeStore = useLocaleStore()
const { effective: appLocale } = storeToRefs(localeStore)

const auth = useAuthStore()
const settingsPath = computed(
  () => `data/${auth.user?.id ?? '…'}/api-settings.json`,
)
const KEY_DIRECT = '__direct__'

/** 勿写入 i18n：JSON 花括号会触发 vue-i18n 占位符解析错误 */
const CUSTOM_PARAMS_JSON_EXAMPLE = '{"stop":["\\n"]}'

const customParamsHint = computed(
  () => t('conn.customParamsHint') + CUSTOM_PARAMS_JSON_EXAMPLE,
)

/** ============ API Key 别名管理 ============ */
const apiKeyManagerOpen = ref(false)
const apiKeyAliasSelectItems = computed(() => [
  { value: KEY_DIRECT, title: t('conn.apiKeyDirectOption') },
  ...apiKeysStore.selectItems,
])
const apiKeySelectValue = computed<string>({
  get: () => conn.apiKeyId ?? KEY_DIRECT,
  set: (v) => {
    conn.setApiKeyId(v === KEY_DIRECT ? null : v)
  },
})
const apiKeyEditable = computed(() => conn.apiKeyId == null)

interface KeyDraft {
  id: string
  alias: string
  key: string
  keyConfigured: boolean
  keyDirty: boolean
}
const keyDrafts = ref<KeyDraft[]>([])
const keyVisible = ref<Record<string, boolean>>({})
const revealDialogOpen = ref(false)
const revealPassword = ref('')
const revealTargetId = ref<string | null>(null)
const revealLoading = ref(false)
const revealError = ref('')

function openApiKeyManager() {
  keyDrafts.value = apiKeysStore.keys.map((k) => ({
    id: k.id,
    alias: k.alias,
    key: '',
    keyConfigured: k.keyConfigured,
    keyDirty: false,
  }))
  keyVisible.value = {}
  apiKeyManagerOpen.value = true
}

function addDraftKey() {
  const draft: KeyDraft = {
    id: `__new__-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    alias: '',
    key: '',
    keyConfigured: false,
    keyDirty: false,
  }
  keyDrafts.value = [...keyDrafts.value, draft]
}

function removeDraftKey(id: string) {
  keyDrafts.value = keyDrafts.value.filter((d) => d.id !== id)
}

function closeApiKeyManager() {
  apiKeyManagerOpen.value = false
}

async function saveApiKeyManager() {
  if (aliasHasError.value) {
    snackbarColor.value = 'warning'
    snackbarText.value = t('conn.apiKeyAliasDupSnackbar')
    snackbar.value = true
    return
  }
  const existingIds = new Set(apiKeysStore.keys.map((k) => k.id))
  const draftIds = new Set<string>()
  for (const d of keyDrafts.value) {
    if (!d.id.startsWith('__new__-')) draftIds.add(d.id)
  }
  for (const id of existingIds) {
    if (!draftIds.has(id)) apiKeysStore.deleteKey(id)
  }
  for (const d of keyDrafts.value) {
    if (d.id.startsWith('__new__-')) {
      if (!d.key.trim()) continue
      const created = apiKeysStore.createKey({ alias: d.alias, keyDraft: d.key })
      d.id = created.id
    } else {
      const patch: Partial<Pick<ApiKeyEntry, 'alias' | 'keyDraft'>> = {
        alias: d.alias,
      }
      if (d.keyDirty) patch.keyDraft = d.key
      apiKeysStore.updateKey(d.id, patch)
    }
  }
  try {
    await apiKeysStore.flushSave()
  } catch (e) {
    await apiKeysStore.reloadFromServer()
    openApiKeyManager()
    const refs = (e as Error & { references?: ApiConfigReference[] }).references
    if (refs?.length) {
      openReferencesDialog(t('conn.deleteKeyBlocked'), refs)
    } else {
      snackbarColor.value = 'error'
      snackbarText.value = e instanceof Error ? e.message : String(e)
      snackbar.value = true
    }
    return
  }
  if (conn.apiKeyId && !apiKeysStore.findById(conn.apiKeyId)) {
    conn.setApiKeyId(null)
  }
  apiKeyManagerOpen.value = false
}

/** 将当前直接键入的 apiKey 另存为一个新别名条目，并让当前 API 预设引用它 */
function saveCurrentKeyAs() {
  const txt = conn.apiKey.trim()
  if (!txt) {
    snackbarColor.value = 'warning'
    snackbarText.value = t('conn.apiKeyEmpty')
    snackbar.value = true
    return
  }
  const created = apiKeysStore.createKey({ keyDraft: txt })
  conn.setApiKeyId(created.id)
  snackbarColor.value = 'success'
  snackbarText.value = t('conn.apiKeySavedSnackbar', { alias: created.alias })
  snackbar.value = true
}

function aliasErrorOf(d: KeyDraft): string | null {
  const a = d.alias.trim()
  if (!a) return null
  const dup = keyDrafts.value.some((x) => x !== d && x.alias.trim() === a)
  if (dup) return t('conn.apiKeyAliasDupErr')
  return null
}

function isKeyVisible(id: string): boolean {
  return Boolean(keyVisible.value[id])
}
function toggleKeyVisible(id: string) {
  keyVisible.value = { ...keyVisible.value, [id]: !keyVisible.value[id] }
}

const aliasHasError = computed(() =>
  keyDrafts.value.some((d) => aliasErrorOf(d) !== null),
)

// 当前所选别名对应条目（用于显示遮罩 key 预览）
const referencedKeyEntry = computed<ApiKeyEntry | undefined>(() =>
  apiKeysStore.findById(conn.apiKeyId),
)

const linkedPromptSelectItems = computed(() =>
  prompts.presets.map((p) => ({
    title: p.name?.trim() ? p.name : p.id,
    value: p.id,
  })),
)

const canExportLinkedPrompt = computed(() =>
  Boolean(
    conn.presets.find((p) => p.id === conn.activePresetId)
      ?.linkedPromptPresetId,
  ),
)

function formatSavedAt(iso: string) {
  return new Date(iso).toLocaleString(intlLocaleTag(appLocale.value))
}

/** 使用 text + 掩码而非 type=password，避免浏览器当作登录密码反复提示保存 */
const showApiKey = ref(false)

const modelDialog = ref(false)

const canFetchModels = computed(
  () => Boolean(conn.baseUrl.trim() && conn.isApiKeyConfigured),
)

function markDraftKeyDirty(d: KeyDraft) {
  d.keyDirty = true
}

function onKeyDraftEyeClick(d: KeyDraft) {
  if (
    !d.id.startsWith('__new__-') &&
    d.keyConfigured &&
    !d.keyDirty &&
    !d.key.trim()
  ) {
    openRevealDialog(d.id)
    return
  }
  toggleKeyVisible(d.id)
}

function keyDraftEyeTitle(d: KeyDraft): string {
  if (
    !d.id.startsWith('__new__-') &&
    d.keyConfigured &&
    !d.keyDirty &&
    !d.key.trim()
  ) {
    return t('conn.apiKeyReveal')
  }
  return isKeyVisible(d.id) ? t('conn.hideApiKey') : t('conn.showApiKey')
}

function openRevealDialog(id: string) {
  revealTargetId.value = id
  revealPassword.value = ''
  revealError.value = ''
  revealDialogOpen.value = true
}

async function confirmRevealKey() {
  const id = revealTargetId.value
  if (!id) return
  revealLoading.value = true
  revealError.value = ''
  try {
    const key = await apiKeysStore.revealKey(id, revealPassword.value)
    const d = keyDrafts.value.find((x) => x.id === id)
    if (d) {
      d.key = key
      d.keyDirty = false
      keyVisible.value = { ...keyVisible.value, [id]: true }
    }
    revealDialogOpen.value = false
  } catch (e) {
    revealError.value = e instanceof Error ? e.message : String(e)
  } finally {
    revealLoading.value = false
  }
}

const canTestConnection = computed(
  () => canFetchModels.value && Boolean(conn.model.trim()),
)

async function onTestConnection() {
  if (!canFetchModels.value) {
    snackbarColor.value = 'warning'
    snackbarText.value = t('conn.needBaseAndKey')
    snackbar.value = true
    return
  }
  if (!conn.model.trim()) {
    snackbarColor.value = 'warning'
    snackbarText.value = t('conn.needModelForTest')
    snackbar.value = true
    return
  }
  connectionTestLoading.value = true
  try {
    await conn.saveToServer()
    const result = await conn.testActivePresetConnection()
    if (result.ok) {
      openTestResultDialog('success', {
        modelsCount: result.models.modelCount,
        modelsMs: result.models.latencyMs,
        chatModel: result.chat.model,
        chatMs: result.chat.latencyMs,
        totalMs: result.totalLatencyMs,
        reply: result.chat.replyPreview,
        replyWarning: result.chat.replyWarning,
      })
    } else if (result.phase === 'chat' && result.models) {
      openTestResultDialog('partial', {
        modelsCount: result.models.modelCount,
        modelsMs: result.models.latencyMs,
        chatModel: result.model ?? conn.model,
        error: result.error,
        detail: result.detail,
      })
    } else {
      openTestResultDialog('failed', {
        error: result.error,
        detail: result.detail,
      })
    }
  } catch (e) {
    snackbarColor.value = 'error'
    snackbarText.value = e instanceof Error ? e.message : String(e)
    snackbar.value = true
  } finally {
    connectionTestLoading.value = false
  }
}

async function onDeleteCurrentPreset() {
  if (conn.presets.length <= 1) return
  try {
    await conn.saveToServer()
  } catch (e) {
    snackbarColor.value = 'error'
    snackbarText.value = e instanceof Error ? e.message : String(e)
    snackbar.value = true
    return
  }
  const result = await conn.removeActivePreset()
  if (result.ok) {
    snackbarColor.value = 'success'
    snackbarText.value = t('conn.deletePresetOk')
    snackbar.value = true
    return
  }
  if (result.references?.length) {
    openReferencesDialog(t('conn.deletePresetBlocked'), result.references)
    return
  }
  snackbarColor.value = 'error'
  snackbarText.value = result.error
  snackbar.value = true
}

function openModelPicker() {
  modelDialog.value = true
}

function bindOptionalNumber(get: () => number | null, set: (n: number | null) => void) {
  return {
    modelValue: get() === null ? '' : String(get()),
    'onUpdate:modelValue': (v: string | null) => {
      if (v === null || v === '') {
        set(null)
        return
      }
      const n = Number(v)
      set(Number.isFinite(n) ? n : null)
    },
  }
}

const dryBreakersText = computed({
  get: () => formatDryBreakersForTextarea(conn.drySequenceBreakers),
  set: (v: string) => {
    conn.drySequenceBreakers = parseDryBreakersFromTextarea(v)
  },
})

async function save() {
  try {
    if (conn.customParamsJson.trim()) {
      conn.parseCustomParams()
    }
    await conn.saveToServer()
    snackbarColor.value = 'success'
    snackbarText.value = t('conn.savedSnackbar', { path: settingsPath.value })
    snackbar.value = true
  } catch (e) {
    snackbarColor.value = 'error'
    snackbarText.value =
      e instanceof Error ? e.message : t('conn.saveFailedJson')
    snackbar.value = true
  }
}

function onPresetSelect(v: string | null) {
  if (v && v !== conn.activePresetId) {
    conn.switchPreset(v)
  }
}

/** ========== API 预设导入 / 导出 ========== */
const exportDialogOpen = ref(false)
const exportIncludeBaseUrl = ref(true)
const exportIncludeApiKey = ref(false)
const exportIncludeLinked = ref(false)

const importFileRef = ref<HTMLInputElement | null>(null)
const importDialogOpen = ref(false)
const pendingImportDoc = ref<ApiPresetExportDoc | null>(null)
const importApplyBaseUrl = ref(true)
const importApplyApiKey = ref(false)
const importApplyLinked = ref(true)

function openExportDialog() {
  exportIncludeApiKey.value = false
  exportIncludeBaseUrl.value = true
  const cur = conn.presets.find((p) => p.id === conn.activePresetId)
  exportIncludeLinked.value = Boolean(cur?.linkedPromptPresetId)
  exportDialogOpen.value = true
}

function triggerDownload(text: string, filename: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

async function confirmExport() {
  try {
    if (!prompts.loaded) await prompts.loadIndexFromServer()
    const { json, filename } = await conn.exportActiveApiPresetDocument({
      includeBaseUrl: exportIncludeBaseUrl.value,
      includeApiKey: exportIncludeApiKey.value,
      includeLinkedPromptPreset: exportIncludeLinked.value,
    })
    triggerDownload(json, filename)
    exportDialogOpen.value = false
    snackbarColor.value = 'success'
    snackbarText.value = t('conn.apiExportDoneSnackbar', { name: filename })
    snackbar.value = true
  } catch (e) {
    snackbarColor.value = 'error'
    snackbarText.value =
      e instanceof Error ? e.message : t('conn.saveFailedJson')
    snackbar.value = true
  }
}

function openImportPick() {
  importFileRef.value?.click()
}

async function onImportFileChange(evt: Event) {
  const input = evt.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const raw: unknown = JSON.parse(text)
    const doc = parseApiPresetExportDoc(raw)
    pendingImportDoc.value = doc
    importApplyBaseUrl.value = exportDocHasBaseUrl(doc)
    importApplyApiKey.value = false
    importApplyLinked.value = exportDocHasLinkedPreset(doc)
    importDialogOpen.value = true
  } catch (e) {
    snackbarColor.value = 'error'
    snackbarText.value =
      e instanceof Error ? e.message : t('conn.apiImportParseFailed')
    snackbar.value = true
  }
}

async function confirmImport() {
  const doc = pendingImportDoc.value
  if (!doc) return
  try {
    await conn.importApiPresetFromParsed(doc, {
      applyBaseUrl: importApplyBaseUrl.value && exportDocHasBaseUrl(doc),
      applyApiKey: importApplyApiKey.value && exportDocHasApiKey(doc),
      importLinkedPromptPreset:
        importApplyLinked.value && exportDocHasLinkedPreset(doc),
    })
    closeImportDialog()
    snackbarColor.value = 'success'
    snackbarText.value = t('conn.apiImportedSnackbar')
    snackbar.value = true
  } catch (e) {
    snackbarColor.value = 'error'
    snackbarText.value =
      e instanceof Error ? e.message : t('conn.saveFailedJson')
    snackbar.value = true
  }
}

function closeImportDialog() {
  importDialogOpen.value = false
  pendingImportDoc.value = null
}
</script>

<template>
  <div class="settings-scroll pa-3">
    <p class="text-body-2 text-medium-emphasis mb-4">
      {{ $t('conn.storageHint', { path: settingsPath }) }}
    </p>

    <FeatureBindingsCard />

    <v-select
      :model-value="conn.activePresetId ?? undefined"
      :items="conn.presetSelectItems"
      item-title="title"
      item-value="value"
      :label="$t('conn.presetEdit')"
      :hint="$t('conn.presetEditHint')"
      persistent-hint
      density="compact"
      hide-details
      variant="outlined"
      class="mb-2"
      @update:model-value="onPresetSelect"
    />
    <div class="d-flex flex-wrap ga-2 mb-4">
      <v-btn
        size="small"
        variant="tonal"
        @click="conn.addPreset()"
      >
        {{ $t('conn.newPreset') }}
      </v-btn>
      <v-btn
        size="small"
        variant="text"
        color="error"
        :disabled="conn.presets.length <= 1"
        @click="onDeleteCurrentPreset"
      >
        {{ $t('conn.deleteCurrent') }}
      </v-btn>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-lan-connect"
        :loading="connectionTestLoading"
        :disabled="!canTestConnection"
        @click="onTestConnection"
      >
        {{ $t('conn.testConnection') }}
      </v-btn>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-tray-arrow-up"
        @click="openExportDialog"
      >
        {{ $t('conn.apiExport') }}
      </v-btn>
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-tray-arrow-down"
        @click="openImportPick"
      >
        {{ $t('conn.apiImport') }}
      </v-btn>
    </div>

    <input
      ref="importFileRef"
      type="file"
      accept="application/json,.json"
      class="d-none"
      @change="onImportFileChange"
    />

    <v-select
      v-model="conn.linkedPromptPresetId"
      :items="linkedPromptSelectItems"
      item-title="title"
      item-value="value"
      :label="$t('conn.linkedPromptPreset')"
      :hint="$t('conn.linkedPromptPresetHint')"
      :placeholder="$t('conn.linkedPromptPlaceholder')"
      persistent-hint
      density="compact"
      variant="outlined"
      clearable
      hide-details="auto"
      class="mb-4"
    />

    <v-text-field
      v-model="conn.alias"
      :label="$t('conn.alias')"
      :hint="$t('conn.aliasHint')"
      persistent-hint
      density="compact"
      class="mb-3"
    />

    <v-text-field
      v-model="conn.baseUrl"
      :label="$t('conn.baseUrl')"
      :hint="$t('conn.baseUrlHint')"
      persistent-hint
      density="compact"
      class="mb-3"
    />

    <div class="d-flex align-center ga-2 mb-2">
      <v-select
        v-model="apiKeySelectValue"
        :items="apiKeyAliasSelectItems"
        item-title="title"
        item-value="value"
        :label="$t('conn.apiKeyAlias')"
        :hint="$t('conn.apiKeyAliasHint')"
        persistent-hint
        density="compact"
        variant="outlined"
        hide-details="auto"
        class="flex-grow-1"
      />
      <v-btn
        size="small"
        variant="tonal"
        prepend-icon="mdi-key-chain-variant"
        @click="openApiKeyManager"
      >
        {{ $t('conn.apiKeyManage') }}
      </v-btn>
    </div>

    <v-text-field
      v-model="conn.apiKey"
      :label="$t('conn.apiKey')"
      type="text"
      name="provider-api-key"
      autocomplete="off"
      autocapitalize="off"
      autocorrect="off"
      spellcheck="false"
      inputmode="text"
      data-lpignore="true"
      data-1p-ignore="true"
      density="compact"
      :readonly="!apiKeyEditable"
      :placeholder="conn.isApiKeyConfigured && !conn.apiKeyDraftDirty && !conn.apiKey.trim()
        ? '••••••'
        : undefined"
      :hint="apiKeyEditable
        ? $t('conn.apiKeyDirectHint')
        : $t('conn.apiKeyFromAliasHint', { alias: referencedKeyEntry?.alias ?? '' })"
      persistent-hint
      class="mb-3 conn-api-key-field"
      :class="{ 'conn-api-key-field--masked': !showApiKey }"
      :append-inner-icon="showApiKey ? 'mdi-eye-off' : 'mdi-eye'"
      :title="showApiKey ? $t('conn.hideApiKey') : $t('conn.showApiKey')"
      @click:append-inner.stop="showApiKey = !showApiKey"
      @update:model-value="conn.markApiKeyDraftDirty()"
    />

    <div
      v-if="apiKeyEditable && (conn.apiKey.trim() || conn.isApiKeyConfigured)"
      class="d-flex justify-end mb-3"
    >
      <v-btn
        size="x-small"
        variant="text"
        prepend-icon="mdi-content-save-outline"
        @click="saveCurrentKeyAs"
      >
        {{ $t('conn.apiKeySaveAsAlias') }}
      </v-btn>
    </div>

    <v-text-field
      :model-value="conn.model"
      :label="$t('conn.modelId')"
      :hint="$t('conn.modelHint')"
      persistent-hint
      density="compact"
      readonly
      append-inner-icon="mdi-menu-down"
      class="mb-3 cursor-pointer"
      @click="openModelPicker"
      @click:append-inner.stop="openModelPicker"
    />

    <v-divider class="mb-3" />
    <p class="text-caption text-medium-emphasis mb-2">
      {{ $t('conn.generationParams') }}
    </p>

    <v-text-field
      v-bind="bindOptionalNumber(() => conn.contextLength, (n) => { conn.contextLength = n })"
      :label="$t('conn.contextLength')"
      type="number"
      :hint="$t('conn.contextLengthHint')"
      persistent-hint
      density="compact"
      class="mb-3"
      min="0"
      step="1"
    />

    <v-text-field
      v-bind="bindOptionalNumber(() => conn.maxTokens, (n) => { conn.maxTokens = n })"
      :label="$t('conn.maxTokens')"
      type="number"
      density="compact"
      class="mb-3"
      min="1"
      step="1"
    />

    <v-switch
      v-model="conn.stream"
      :label="$t('conn.stream')"
      color="primary"
      density="compact"
      hide-details
      class="mb-3"
    />

    <v-switch
      v-model="conn.requestReasoningChain"
      :label="$t('conn.requestReasoningChain')"
      :hint="$t('conn.requestReasoningChainHint')"
      persistent-hint
      color="primary"
      density="compact"
      class="mb-3"
    />

    <v-switch
      v-model="conn.showReasoningChain"
      :label="$t('conn.showReasoningChain')"
      :hint="$t('conn.showReasoningChainHint')"
      persistent-hint
      color="primary"
      density="compact"
      class="mb-3"
    />

    <v-text-field
      v-bind="bindOptionalNumber(() => conn.temperature, (n) => { conn.temperature = n })"
      :label="$t('conn.temperature')"
      type="number"
      density="compact"
      class="mb-3"
      min="0"
      max="2"
      step="0.1"
    />

    <v-text-field
      v-bind="bindOptionalNumber(() => conn.topP, (n) => { conn.topP = n })"
      :label="$t('conn.topP')"
      type="number"
      density="compact"
      class="mb-3"
      min="0"
      max="1"
      step="0.05"
    />

    <v-text-field
      v-bind="bindOptionalNumber(() => conn.topK, (n) => { conn.topK = n })"
      :label="$t('conn.topK')"
      type="number"
      :hint="$t('conn.topKHint')"
      persistent-hint
      density="compact"
      class="mb-3"
      min="0"
      step="1"
    />

    <v-expansion-panels
      variant="accordion"
      class="mb-3"
    >
      <v-expansion-panel>
        <v-expansion-panel-title>
          {{ $t('conn.drySection') }}
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <p class="text-caption text-medium-emphasis mb-3">
            {{ $t('conn.dryHint') }}
          </p>

          <v-text-field
            v-bind="bindOptionalNumber(() => conn.dryMultiplier, (n) => { conn.dryMultiplier = n })"
            :label="$t('conn.dryMultiplier')"
            type="number"
            density="compact"
            class="mb-3"
            step="0.1"
          />

          <v-text-field
            v-bind="bindOptionalNumber(() => conn.dryBase, (n) => { conn.dryBase = n })"
            :label="$t('conn.dryBase')"
            type="number"
            density="compact"
            class="mb-3"
            step="0.01"
          />

          <v-text-field
            v-bind="bindOptionalNumber(() => conn.dryAllowedLength, (n) => { conn.dryAllowedLength = n })"
            :label="$t('conn.dryAllowedLength')"
            type="number"
            density="compact"
            class="mb-3"
            min="0"
            step="1"
          />

          <v-text-field
            v-bind="bindOptionalNumber(() => conn.dryPenaltyLastN, (n) => { conn.dryPenaltyLastN = n })"
            :label="$t('conn.dryPenaltyLastN')"
            type="number"
            :hint="$t('conn.dryPenaltyLastNHint')"
            persistent-hint
            density="compact"
            class="mb-3"
            min="0"
            step="1"
          />

          <v-textarea
            v-model="dryBreakersText"
            :label="$t('conn.drySequenceBreakers')"
            :hint="$t('conn.drySequenceBreakersHint')"
            persistent-hint
            variant="outlined"
            rows="4"
            auto-grow
            spellcheck="false"
          />
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <v-text-field
      v-bind="bindOptionalNumber(() => conn.frequencyPenalty, (n) => { conn.frequencyPenalty = n })"
      :label="$t('conn.frequencyPenalty')"
      type="number"
      density="compact"
      class="mb-3"
      min="-2"
      max="2"
      step="0.1"
    />

    <v-text-field
      v-bind="bindOptionalNumber(() => conn.presencePenalty, (n) => { conn.presencePenalty = n })"
      :label="$t('conn.presencePenalty')"
      type="number"
      density="compact"
      class="mb-4"
      min="-2"
      max="2"
      step="0.1"
    />

    <v-textarea
      v-model="conn.customParamsJson"
      :label="$t('conn.customParams')"
      :hint="customParamsHint"
      persistent-hint
      variant="outlined"
      rows="4"
      auto-grow
      class="mb-4"
      spellcheck="false"
    />

    <v-btn
      block
      color="primary"
      variant="flat"
      @click="save"
    >
      {{ $t('conn.saveButton') }}
    </v-btn>

    <p
      v-if="conn.lastSavedAt"
      class="text-caption text-medium-emphasis mt-2 mb-0"
    >
      {{ $t('conn.lastSaved') }}{{ formatSavedAt(conn.lastSavedAt) }}
    </p>
  </div>

  <v-dialog
    v-model="apiKeyManagerOpen"
    scrollable
  >
    <v-card>
      <v-card-title class="text-subtitle-1">
        {{ $t('conn.apiKeyManagerTitle') }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-3">
          {{ $t('conn.apiKeyManagerHint') }}
        </p>
        <v-btn
          size="small"
          variant="tonal"
          class="mb-3"
          prepend-icon="mdi-plus"
          @click="addDraftKey"
        >
          {{ $t('conn.apiKeyAdd') }}
        </v-btn>
        <div
          v-for="d in keyDrafts"
          :key="d.id"
          class="api-key-row border rounded pa-3 mb-3"
        >
          <div class="d-flex flex-wrap ga-2 align-start">
            <v-text-field
              v-model="d.alias"
              :label="$t('conn.apiKeyAliasField')"
              density="compact"
              variant="outlined"
              hide-details="auto"
              :error-messages="aliasErrorOf(d) ? [aliasErrorOf(d)!] : undefined"
              class="flex-grow-1"
              style="min-width: 8rem"
            />
            <v-btn
              icon="mdi-delete-outline"
              size="small"
              variant="text"
              color="error"
              :aria-label="$t('conn.apiKeyRemove')"
              @click="removeDraftKey(d.id)"
            />
          </div>
          <v-text-field
            v-model="d.key"
            :label="$t('conn.apiKeyValueField')"
            type="text"
            density="compact"
            variant="outlined"
            class="mt-2 conn-api-key-field"
            :class="{ 'conn-api-key-field--masked': !isKeyVisible(d.id) }"
            autocomplete="off"
            spellcheck="false"
            :placeholder="d.keyConfigured && !d.keyDirty && !d.key ? '••••••' : undefined"
            :append-inner-icon="isKeyVisible(d.id) ? 'mdi-eye-off' : 'mdi-eye'"
            :title="keyDraftEyeTitle(d)"
            @click:append-inner.stop="onKeyDraftEyeClick(d)"
            @update:model-value="markDraftKeyDirty(d)"
          />
        </div>
        <p
          v-if="!keyDrafts.length"
          class="text-body-2 text-medium-emphasis"
        >
          {{ $t('conn.apiKeyManagerEmpty') }}
        </p>
      </v-card-text>
      <v-card-actions class="px-4 pb-3">
        <v-spacer />
        <v-btn
          variant="text"
          @click="closeApiKeyManager"
        >
          {{ $t('conn.close') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :disabled="aliasHasError"
          @click="saveApiKeyManager"
        >
          {{ $t('conn.apiKeyManagerSave') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    v-model="revealDialogOpen"
    max-width="24rem"
  >
    <v-card>
      <v-card-title class="text-subtitle-1">
        {{ $t('conn.apiKeyRevealTitle') }}
      </v-card-title>
      <v-card-text>
        <v-text-field
          v-model="revealPassword"
          :label="$t('conn.apiKeyRevealPassword')"
          type="password"
          density="compact"
          variant="outlined"
          hide-details="auto"
          autocomplete="current-password"
          @keyup.enter="confirmRevealKey"
        />
        <v-alert
          v-if="revealError"
          type="error"
          variant="tonal"
          density="compact"
          class="mt-3"
        >
          {{ revealError }}
        </v-alert>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="revealDialogOpen = false">
          {{ $t('conn.close') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          :loading="revealLoading"
          @click="confirmRevealKey"
        >
          {{ $t('conn.apiKeyRevealConfirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    v-model="exportDialogOpen"
  >
    <v-card>
      <v-card-title class="text-subtitle-1">
        {{ $t('conn.apiExportDialogTitle') }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-3">
          {{ $t('conn.apiExportHint') }}
        </p>
        <v-checkbox
          v-model="exportIncludeBaseUrl"
          :label="$t('conn.apiExportIncludeBaseUrl')"
          density="compact"
          hide-details
          class="mb-1"
        />
        <v-checkbox
          v-model="exportIncludeApiKey"
          :label="$t('conn.apiExportIncludeApiKey')"
          density="compact"
          hide-details
          class="mb-1"
        />
        <v-checkbox
          v-model="exportIncludeLinked"
          :label="$t('conn.apiExportIncludeLinkedPreset')"
          :disabled="!canExportLinkedPrompt"
          density="compact"
          hide-details
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="exportDialogOpen = false"
        >
          {{ $t('conn.close') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          @click="confirmExport"
        >
          {{ $t('conn.apiExportConfirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    v-model="importDialogOpen"
  >
    <v-card v-if="pendingImportDoc">
      <v-card-title class="text-subtitle-1">
        {{ $t('conn.apiImportDialogTitle') }}
      </v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-3">
          {{ $t('conn.apiImportHint') }}
        </p>
        <v-checkbox
          v-model="importApplyBaseUrl"
          :label="$t('conn.apiImportApplyBaseUrl')"
          :disabled="!exportDocHasBaseUrl(pendingImportDoc)"
          density="compact"
          hide-details
          class="mb-1"
        />
        <v-checkbox
          v-model="importApplyApiKey"
          :label="$t('conn.apiImportApplyApiKey')"
          :disabled="!exportDocHasApiKey(pendingImportDoc)"
          density="compact"
          hide-details
          class="mb-1"
        />
        <v-checkbox
          v-model="importApplyLinked"
          :label="$t('conn.apiImportApplyLinkedPreset')"
          :disabled="!exportDocHasLinkedPreset(pendingImportDoc)"
          density="compact"
          hide-details
        />
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="closeImportDialog"
        >
          {{ $t('conn.close') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="flat"
          @click="confirmImport"
        >
          {{ $t('conn.apiImportConfirm') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <ApiModelPickerDialog
    v-model="modelDialog"
    :model-id="conn.model"
    :api-preset-id="conn.activePresetId"
    @update:model-id="(v) => { conn.model = v }"
  />

  <v-dialog
    v-model="testResultDialogOpen"
    max-width="560"
    scrollable
  >
    <v-card v-if="testResultDialog">
      <v-card-title>{{ $t('conn.testResultDialogTitle') }}</v-card-title>
      <v-card-text>
        <v-alert
          v-if="testResultDialogKind === 'success'"
          type="success"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ $t('conn.testResultSuccessHint') }}
        </v-alert>
        <v-alert
          v-else-if="testResultDialogKind === 'partial'"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ $t('conn.testResultPartialHint') }}
        </v-alert>
        <v-alert
          v-else
          type="error"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ testResultDialog.error }}
        </v-alert>

        <template v-if="testResultDialog.modelsCount != null">
          <p class="text-subtitle-2 mb-1">
            {{ $t('conn.testResultPhaseModels') }}
          </p>
          <p class="text-body-2 mb-3">
            {{
              $t('conn.testResultModelsLine', {
                count: String(testResultDialog.modelsCount),
                ms: String(testResultDialog.modelsMs ?? '—'),
              })
            }}
          </p>
        </template>

        <template
          v-if="testResultDialogKind !== 'failed' && testResultDialog.chatModel"
        >
          <p class="text-subtitle-2 mb-1">
            {{ $t('conn.testResultPhaseChat') }}
          </p>
          <p class="text-body-2 mb-1">
            {{
              $t('conn.testResultChatLine', {
                model: testResultDialog.chatModel,
                ms: String(testResultDialog.chatMs ?? '—'),
              })
            }}
          </p>
          <v-alert
            v-if="testResultDialog.replyWarning === 'truncated'"
            type="warning"
            variant="tonal"
            density="compact"
            class="mb-2 text-body-2"
          >
            {{ $t('conn.testResultReplyTruncated') }}
          </v-alert>
          <p
            v-if="testResultDialog.reply"
            class="text-body-2 text-pre-wrap test-result-reply mb-3"
          >
            {{ testResultDialog.reply }}
          </p>
        </template>

        <p
          v-if="testResultDialog.totalMs != null"
          class="text-caption text-medium-emphasis"
        >
          {{
            $t('conn.testResultTotalMs', {
              ms: String(testResultDialog.totalMs),
            })
          }}
        </p>

        <p
          v-if="testResultDialog.detail"
          class="text-body-2 text-pre-wrap text-error mt-2"
        >
          {{ testResultDialog.detail.slice(0, 1200) }}
        </p>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="flat"
          color="primary"
          @click="testResultDialogOpen = false"
        >
          {{ $t('conn.close') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    v-model="referencesDialogOpen"
    max-width="520"
  >
    <v-card>
      <v-card-title>{{ referencesDialogTitle }}</v-card-title>
      <v-card-text>
        <p class="text-body-2 text-medium-emphasis mb-3">
          {{ $t('conn.referencesDialogHint') }}
        </p>
        <v-list
          density="compact"
          class="border rounded"
        >
          <v-list-item
            v-for="(line, i) in referencesDialogItems"
            :key="i"
            :title="line"
            prepend-icon="mdi-link-variant"
          />
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="referencesDialogOpen = false"
        >
          {{ $t('conn.close') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-snackbar
    v-model="snackbar"
    :color="snackbarColor"
    location="bottom"
    :timeout="2800"
  >
    {{ snackbarText }}
  </v-snackbar>
</template>

<style scoped>
.settings-scroll {
  max-height: calc(100vh - 7.5rem);
  overflow-y: auto;
}

.cursor-pointer :deep(.v-field) {
  cursor: pointer;
}

.test-result-reply {
  max-height: 12rem;
  overflow-y: auto;
  padding: 0.5rem 0.75rem;
  border-radius: 4px;
  background: rgba(var(--v-theme-on-surface), 0.04);
  word-break: break-word;
}

/* 圆点掩码（Chromium / WebKit）；非 WebKit 浏览器在隐藏模式下可能为明文，可点眼睛图标查看 */
.conn-api-key-field--masked :deep(input) {
  -webkit-text-security: disc;
}
</style>
