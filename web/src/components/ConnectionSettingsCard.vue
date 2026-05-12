<script setup lang="ts">
import { intlLocaleTag } from '@/i18n/locale'
import { useConnectionStore } from '@/stores/connection'
import { useLocaleStore } from '@/stores/locale'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
const conn = useConnectionStore()
const localeStore = useLocaleStore()
const { effective: appLocale } = storeToRefs(localeStore)

const settingsPath = 'server/data/api-settings.json'

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

const snackbar = ref(false)
const snackbarText = ref('')
const snackbarColor = ref<'success' | 'error' | 'warning'>('success')

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
    </div>

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
      class="mb-3 conn-api-key-field"
      :class="{ 'conn-api-key-field--masked': !showApiKey }"
      :append-inner-icon="showApiKey ? 'mdi-eye-off' : 'mdi-eye'"
      :title="showApiKey ? $t('conn.hideApiKey') : $t('conn.showApiKey')"
      @click:append-inner.stop="showApiKey = !showApiKey"
    />

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
    v-model="modelDialog"
    max-width="560"
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
  max-height: calc(100vh - 120px);
  overflow-y: auto;
}

.cursor-pointer :deep(.v-field) {
  cursor: pointer;
}

.model-dialog-list {
  max-height: min(50vh, 320px);
  overflow-y: auto;
}

/* 圆点掩码（Chromium / WebKit）；非 WebKit 浏览器在隐藏模式下可能为明文，可点眼睛图标查看 */
.conn-api-key-field--masked :deep(input) {
  -webkit-text-security: disc;
}
</style>
