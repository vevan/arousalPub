<script setup lang="ts">
import { useConnectionStore } from '@/stores/connection'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  /** dialog open */
  modelValue: boolean
  modelId: string
  /** 用于 /api/models 解析连接；缺省则用当前激活 preset */
  apiPresetId?: string | null
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', v: boolean): void
  (e: 'update:modelId', v: string): void
  (e: 'selected', id: string): void
}>()

const { t } = useI18n()
const conn = useConnectionStore()
const { presets, activePresetId } = storeToRefs(conn)

const modelsList = ref<string[]>([])
const modelsLoading = ref(false)
const modelsError = ref('')
const modelFilter = ref('')
const manualModelId = ref('')

const resolvedPresetId = computed(
  () => props.apiPresetId?.trim() || activePresetId.value || presets.value[0]?.id || '',
)

const resolvedPreset = computed(() =>
  presets.value.find((p) => p.id === resolvedPresetId.value) ?? null,
)

const canFetchModels = computed(() => {
  const p = resolvedPreset.value
  if (!p?.baseUrl?.trim()) return false
  return Boolean(p.keyConfigured || p.apiKey?.trim())
})

const filteredModels = computed(() => {
  const q = modelFilter.value.trim().toLowerCase()
  if (!q) return modelsList.value
  return modelsList.value.filter((id) => id.toLowerCase().includes(q))
})

const filterSummary = computed(() => {
  const total = modelsList.value.length
  const shown = filteredModels.value.length
  if (!total) return ''
  if (!modelFilter.value.trim()) {
    return t('conn.modelsCount', { count: total })
  }
  return t('conn.modelsFilterCount', { shown, total })
})

function close() {
  emit('update:modelValue', false)
}

async function fetchModels() {
  if (!canFetchModels.value) {
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
      body: JSON.stringify({
        apiPresetId: resolvedPresetId.value || undefined,
      }),
    })
    const data = (await res.json()) as {
      models?: string[]
      error?: string
      detail?: string
    }
    if (!res.ok) {
      modelsList.value = []
      modelsError.value =
        data.detail ||
        data.error ||
        t('chat.errors.requestFailedStatus', { status: String(res.status) })
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

function selectModel(id: string) {
  emit('update:modelId', id)
  emit('selected', id)
  close()
}

function applyManualModel() {
  const id = manualModelId.value.trim()
  if (!id) return
  selectModel(id)
}

watch(
  () => props.modelValue,
  (open) => {
    if (!open) return
    modelFilter.value = ''
    manualModelId.value = props.modelId
    void fetchModels()
  },
)

watch(
  () => props.modelId,
  (id) => {
    if (props.modelValue) manualModelId.value = id
  },
)
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    scrollable
    max-width="640"
    @update:model-value="emit('update:modelValue', $event)"
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
        <v-alert
          v-if="!canFetchModels"
          type="warning"
          variant="tonal"
          density="compact"
          class="mb-3"
        >
          {{ $t('conn.needBaseAndKey') }}
        </v-alert>

        <v-text-field
          v-model="modelFilter"
          :label="$t('conn.filterModels')"
          density="compact"
          variant="outlined"
          clearable
          prepend-inner-icon="mdi-magnify"
          hide-details="auto"
          class="mb-1"
          :disabled="!modelsList.length && !modelsLoading"
          autofocus
        />
        <p
          v-if="filterSummary"
          class="api-model-picker__summary text-caption text-medium-emphasis mb-3"
        >
          {{ filterSummary }}
        </p>

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
          class="api-model-picker__list border rounded"
          density="compact"
          nav
        >
          <template v-if="filteredModels.length">
            <v-list-item
              v-for="id in filteredModels"
              :key="id"
              :title="id"
              :active="modelId === id"
              @click="selectModel(id)"
            />
          </template>
          <v-list-item
            v-else
            disabled
            :title="$t('conn.noFilterMatches')"
          />
        </v-list>

        <p
          v-else-if="!modelsLoading && !modelsError && canFetchModels"
          class="text-body-2 text-medium-emphasis mb-3"
        >
          {{ $t('conn.emptyModels') }}
        </p>

        <v-divider class="my-3" />

        <v-text-field
          v-model="manualModelId"
          :label="$t('conn.manualModelId')"
          :hint="$t('conn.manualModelHint')"
          persistent-hint
          density="compact"
          variant="outlined"
          hide-details="auto"
          class="mb-2"
          @keyup.enter="applyManualModel"
        />
        <v-btn
          size="small"
          variant="tonal"
          :disabled="!manualModelId.trim()"
          @click="applyManualModel"
        >
          {{ $t('conn.applyManualModel') }}
        </v-btn>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-3">
        <v-spacer />
        <v-btn
          variant="text"
          @click="close"
        >
          {{ $t('conn.close') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.api-model-picker__list {
  max-height: min(52vh, 22rem);
  overflow-y: auto;
}

.api-model-picker__summary {
  margin-top: 0.25rem;
}
</style>
