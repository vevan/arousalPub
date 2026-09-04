<script setup lang="ts">
import {
  buildEmbeddingOverridePatch,
  resolveEmbeddingFormDraft,
  type ConversationEmbeddingApiSettingsOverride,
} from '@/utils/conversation-api-settings'
import { ref, watch } from 'vue'

const props = defineProps<{
  useGlobal: boolean
  override?: ConversationEmbeddingApiSettingsOverride
  globalModel: string
  globalDimensions: number | null
  disabled: boolean
}>()

const emit = defineEmits<{
  (e: 'update:useGlobal', value: boolean): void
  (e: 'save', value: ConversationEmbeddingApiSettingsOverride | null): void
}>()

const useGlobalDraft = ref(props.useGlobal)
const model = ref('')
const dimensions = ref<number | ''>('')

function syncFromProps(): void {
  useGlobalDraft.value = props.useGlobal
  const draft = resolveEmbeddingFormDraft(
    props.globalModel,
    props.globalDimensions,
    props.override,
  )
  model.value = draft.model
  dimensions.value = draft.dimensions
}

watch(
  () => [
    props.useGlobal,
    JSON.stringify(props.override ?? null),
    props.globalModel,
    props.globalDimensions,
  ],
  syncFromProps,
  { immediate: true },
)

function save(): void {
  emit('update:useGlobal', useGlobalDraft.value)
  if (useGlobalDraft.value) {
    emit('save', null)
    return
  }
  const patch = buildEmbeddingOverridePatch(
    props.globalModel,
    props.globalDimensions,
    model.value,
    dimensions.value,
    props.override,
  )
  // undefined：与全局一致且本无覆盖 — 仍发 null 语义上「无会话覆盖」
  emit('save', patch === undefined ? null : patch)
}
</script>

<template>
  <div class="conv-settings-subsection">
    <h4 class="conv-settings-subsection__title">
      {{ $t('chat.convSettings.embeddingApiSection') }}
    </h4>
    <v-switch
      v-model="useGlobalDraft"
      :label="$t('chat.convSettings.embeddingApiUseGlobal')"
      density="comfortable"
      hide-details
      color="primary"
      :disabled="disabled"
    />
    <template v-if="!useGlobalDraft">
      <v-text-field
        v-model="model"
        :label="$t('settings.embeddingModel')"
        density="comfortable"
        variant="outlined"
        hide-details="auto"
        :disabled="disabled"
      />
      <v-text-field
        v-model="dimensions"
        type="number"
        :label="$t('settings.embeddingDimensions')"
        density="comfortable"
        variant="outlined"
        hide-details="auto"
        :disabled="disabled"
      />
    </template>
    <v-btn block color="primary" variant="flat" class="mt-3" :disabled="disabled" @click="save">
      {{ $t('chat.convSettings.saveEmbedding') }}
    </v-btn>
  </div>
</template>
