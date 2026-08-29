<script setup lang="ts">
import type { ConversationEmbeddingApiSettingsOverride } from '@/utils/conversation-api-settings'
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
const dimensions = ref<number | null>(null)

function syncFromProps(): void {
  useGlobalDraft.value = props.useGlobal
  model.value = props.override?.embeddingModel ?? props.globalModel
  dimensions.value = props.override?.embeddingDimensions ?? props.globalDimensions
}

watch(() => [props.useGlobal, props.override, props.globalModel, props.globalDimensions], syncFromProps, {
  deep: true,
  immediate: true,
})

function save(): void {
  emit('update:useGlobal', useGlobalDraft.value)
  emit('save', useGlobalDraft.value ? null : {
    embeddingModel: model.value.trim(),
    embeddingDimensions: dimensions.value,
  })
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
        v-model.number="dimensions"
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
