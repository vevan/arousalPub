<script setup lang="ts">
import { intlLocaleTag } from '@/i18n/locale'
import { useApiKeysStore, type ApiKeyEntry } from '@/stores/apiKeys'
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
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref<'success' | 'error' | 'warning'>('success')

const conn = useConnectionStore()
const prompts = usePromptsStore()
const apiKeysStore = useApiKeysStore()
const localeStore = useLocaleStore()
const { effective: appLocale } = storeToRefs(localeStore)

const settingsPath = 'data/api-settings.json'
const KEY_DIRECT = '__direct__'

onMounted(() => {
  void prompts.loadFromServer()
  void apiKeysStore.loadFromServer()
})

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
}
const keyDrafts = ref<KeyDraft[]>([])
const keyVisible = ref<Record<string, boolean>>({})

function openApiKeyManager() {
  keyDrafts.value = apiKeysStore.keys.map((k) => ({
    id: k.id,
    alias: k.alias,
    key: k.key,
  }))
  keyVisible.value = {}
  apiKeyManagerOpen.value = true
}

function addDraftKey() {
  const draft: KeyDraft = {
    id: `__new__-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    alias: '',
    key: '',
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
      const created = apiKeysStore.createKey({ alias: d.alias, key: d.key })
      // 让用户在草稿里看到分配后的 id；不强求
      d.id = created.id
    } else {
      apiKeysStore.updateKey(d.id, { alias: d.alias, key: d.key })
    }
  }
  await apiKeysStore.flushSave()
  // 若当前预设引用的 keyId 被删了：清空
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
  const created = apiKeysStore.createKey({ key: txt })
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
const modelsList = ref<string[]>([])
const modelsLoading = ref(false)
const modelsError = ref('')
const modelFilter = ref('')

const filteredModels = computed(() => {
  const q = modelFilter.value.trim().toLowerCase()
  if (!q) return modelsList.value
  return modelsList.value.filter((id) => id.toLowerCase().includes(q))
})

const canFetchModels = computed(
  () => Boolean(conn.baseUrl.trim() && conn.apiKey.trim()),
)

async function fetchModels() {
  const bu = conn.baseUrl.trim()
  const key = conn.apiKey.trim()
  if (!bu || !key) {
    modelsList.value = []
    modelsError.value = ''
    return
  }
  modelsLoading.value = true
  modelsError.value = ''
  try {
    const res = await fetch('/api/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl: bu || undefined, apiKey: key }),
    })
    const data = (await res.json()) as {
      models?: string[]
      error?: string
      detail?: string
    }
    if (!res.ok) {
      modelsList.value = []
      modelsError.value =
        data.detail || data.error || t('chat.errors.requestFailedStatus', { status: String(res.status) })
      return
    }
    modelsList.value = data.models ?? []
  } catch (e) {
    modelsList.value = []
    modelsError.value = e instanceof Error ? e.message : String(e)
  } finally {
    modelsLoading.value = false
  }
}

async function openModelPicker() {
  if (!canFetchModels.value) {
    snackbarColor.value = 'warning'
    snackbarText.value = t('conn.needBaseAndKey')
    snackbar.value = true
    return
  }
  modelFilter.value = ''
  modelDialog.value = true
  await fetchModels()
}

function selectModelAndClose(id: string) {
  conn.model = id
  modelDialog.value = false
}

watch(
  () => conn.activePresetId,
  () => {
    modelFilter.value = ''
  },
)

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

async function save() {
  try {
    if (conn.customParamsJson.trim()) {
      conn.parseCustomParams()
    }
    await conn.saveToServer()
    snackbarColor.value = 'success'
    snackbarText.value = t('conn.savedSnackbar', { path: settingsPath })
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
    await prompts.loadFromServer()
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

    <v-select
      :model-value="conn.activePresetId ?? undefined"
      :items="conn.presetSelectItems"
      item-title="title"
      item-value="value"
      :label="$t('conn.preset')"
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
        @click="conn.removeActivePreset()"
      >
        {{ $t('conn.deleteCurrent') }}
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
      :hint="apiKeyEditable
        ? $t('conn.apiKeyDirectHint')
        : $t('conn.apiKeyFromAliasHint', { alias: referencedKeyEntry?.alias ?? '' })"
      persistent-hint
      class="mb-3 conn-api-key-field"
      :class="{ 'conn-api-key-field--masked': !showApiKey }"
      :append-inner-icon="showApiKey ? 'mdi-eye-off' : 'mdi-eye'"
      :title="showApiKey ? $t('conn.hideApiKey') : $t('conn.showApiKey')"
      @click:append-inner.stop="showApiKey = !showApiKey"
    />

    <div
      v-if="apiKeyEditable && conn.apiKey.trim()"
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

    <v-text-field
      v-bind="bindOptionalNumber(() => conn.dry, (n) => { conn.dry = n })"
      :label="$t('conn.dry')"
      type="number"
      :hint="$t('conn.dryHint')"
      persistent-hint
      density="compact"
      class="mb-3"
      step="0.1"
    />

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
      :hint="$t('conn.customParamsHint')"
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
            :append-inner-icon="isKeyVisible(d.id) ? 'mdi-eye-off' : 'mdi-eye'"
            @click:append-inner.stop="toggleKeyVisible(d.id)"
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

  <v-dialog
    v-model="modelDialog"
    scrollable
  >
    <v-card>
      <v-card-title class="d-flex align-center flex-wrap ga-2">
        <span>{{ $t('conn.pickModel') }}</span>
        <v-spacer />
        <v-btn
          size="small"
          variant="text"
          :loading="modelsLoading"
          :disabled="!canFetchModels"
          @click="fetchModels"
        >
          {{ $t('conn.reloadModels') }}
        </v-btn>
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-4">
        <v-text-field
          v-model="modelFilter"
          :label="$t('conn.filterModels')"
          density="compact"
          variant="outlined"
          clearable
          prepend-inner-icon="mdi-magnify"
          hide-details
          class="mb-3"
          :disabled="!modelsList.length && !modelsLoading"
        />

        <v-progress-linear
          v-if="modelsLoading"
          indeterminate
          class="mb-2"
        />

        <v-alert
          v-if="modelsError"
          type="warning"
          variant="tonal"
          density="compact"
          class="text-pre-wrap mb-3"
        >
          {{ modelsError }}
        </v-alert>

        <v-list
          v-if="modelsList.length && !modelsLoading"
          class="model-dialog-list border rounded"
          density="compact"
          nav
        >
          <template v-if="filteredModels.length">
            <v-list-item
              v-for="id in filteredModels"
              :key="id"
              :title="id"
              :active="conn.model === id"
              @click="selectModelAndClose(id)"
            />
          </template>
          <v-list-item
            v-else
            disabled
            :title="$t('conn.noFilterMatches')"
          />
        </v-list>

        <p
          v-else-if="!modelsLoading && !modelsError"
          class="text-body-2 text-medium-emphasis mb-3"
        >
          {{ $t('conn.emptyModels') }}
        </p>

        <v-divider class="my-3" />

        <v-text-field
          v-model="conn.model"
          :label="$t('conn.manualModelId')"
          :hint="$t('conn.manualModelHint')"
          persistent-hint
          density="compact"
          variant="outlined"
          class="mb-2"
        />
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-3">
        <v-spacer />
        <v-btn
          variant="text"
          @click="modelDialog = false"
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

.model-dialog-list {
  max-height: min(50vh, 20rem);
  overflow-y: auto;
}

/* 圆点掩码（Chromium / WebKit）；非 WebKit 浏览器在隐藏模式下可能为明文，可点眼睛图标查看 */
.conn-api-key-field--masked :deep(input) {
  -webkit-text-security: disc;
}
</style>
