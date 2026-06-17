<script setup lang="ts">
import ApiModelPickerDialog from '@/components/settings/ApiModelPickerDialog.vue'
import { useConnectionStore } from '@/stores/connection'
import {
  buildChatBindingPatch,
  mergePresetWithChatBinding,
  optionalNumToField,
  type ConversationChatBinding,
  type ConversationEmbeddingApiSettingsOverride,
  type ResolvedConversationChatDisplay,
} from '@/utils/conversation-api-settings'
import {
  formatDryBreakersForTextarea,
  parseDryBreakersFromTextarea,
} from '@/utils/dry-sampler'
import { normalizeEmbeddingDimensions } from '@/utils/embedding-api-settings'
import type { ApiPreset } from '@/stores/connection'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const SAVE_DEBOUNCE_MS = 150

let lastChatBindingJson = ''
let lastEmbeddingPatchJson = ''

const props = defineProps<{
  chatUseGlobal: boolean
  chatBinding: ConversationChatBinding | null
  embeddingUseGlobal: boolean
  embeddingOverride?: ConversationEmbeddingApiSettingsOverride
  globalEmbeddingModel: string
  globalEmbeddingDimensions: number | null
  allowPropSync?: boolean
  disabled?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:chatUseGlobal', v: boolean): void
  (e: 'update:embeddingUseGlobal', v: boolean): void
  (e: 'saveChat', binding: ConversationChatBinding | null): void
  (e: 'saveEmbedding', patch: ConversationEmbeddingApiSettingsOverride | null): void
}>()

const { t } = useI18n()
const conn = useConnectionStore()
const { presets, activePresetId } = storeToRefs(conn)

const INHERIT = ''

const chatPresetSelect = ref(INHERIT)
const chatModel = ref('')
const chatContextLength = ref<number | ''>('')
const chatMaxTokens = ref<number | ''>('')
const chatStream = ref(true)
const chatRequestReasoning = ref(false)
const chatShowReasoning = ref(false)
const chatTemperature = ref<number | ''>('')
const chatTopP = ref<number | ''>('')
const chatTopK = ref<number | ''>('')
const chatDryMultiplier = ref<number | ''>('')
const chatDryBase = ref<number | ''>('')
const chatDryAllowedLength = ref<number | ''>('')
const chatDryPenaltyLastN = ref<number | ''>('')
const dryBreakersText = ref('')
const chatFrequencyPenalty = ref<number | ''>('')
const chatPresencePenalty = ref<number | ''>('')
const chatCustomParamsJson = ref('')

const embeddingModel = ref('')
const embeddingDimensions = ref<number | ''>('')

let chatSaveTimer: ReturnType<typeof setTimeout> | null = null
let embeddingSaveTimer: ReturnType<typeof setTimeout> | null = null

const modelPickerOpen = ref(false)

const globalPreset = computed(() => {
  const id = activePresetId.value ?? presets.value[0]?.id
  return presets.value.find((p) => p.id === id) ?? presets.value[0] ?? null
})

const presetItems = computed(() => [
  {
    title: t('chat.convSettings.chatApiPresetInheritActive'),
    value: INHERIT,
  },
  ...presets.value.map((p) => ({
    title: p.alias.trim() || p.id,
    value: p.id,
  })),
])

const selectedPreset = computed(() => {
  const id =
    chatPresetSelect.value && chatPresetSelect.value !== INHERIT
      ? chatPresetSelect.value
      : globalPreset.value?.id
  return presets.value.find((p) => p.id === id) ?? globalPreset.value
})

const modelPickerPresetId = computed(() => selectedPreset.value?.id ?? null)

function openModelPicker() {
  if (props.disabled) return
  modelPickerOpen.value = true
}

function onModelPicked(id: string) {
  chatModel.value = id
  scheduleChatSave()
}

function bindingFromForm(): ConversationChatBinding {
  const b: ConversationChatBinding = {}
  if (chatPresetSelect.value && chatPresetSelect.value !== INHERIT) {
    b.apiConfigId = chatPresetSelect.value
  }
  if (chatModel.value.trim()) b.model = chatModel.value.trim()
  if (chatContextLength.value !== '') {
    b.contextLength = Number(chatContextLength.value)
  }
  if (chatMaxTokens.value !== '') b.maxTokens = Number(chatMaxTokens.value)
  b.stream = chatStream.value
  b.requestReasoningChain = chatRequestReasoning.value
  b.showReasoningChain = chatShowReasoning.value
  if (chatTemperature.value !== '') b.temperature = Number(chatTemperature.value)
  if (chatTopP.value !== '') b.topP = Number(chatTopP.value)
  if (chatTopK.value !== '') b.topK = Number(chatTopK.value)
  if (chatDryMultiplier.value !== '') {
    b.dryMultiplier = Number(chatDryMultiplier.value)
  }
  if (chatDryBase.value !== '') b.dryBase = Number(chatDryBase.value)
  if (chatDryAllowedLength.value !== '') {
    b.dryAllowedLength = Number(chatDryAllowedLength.value)
  }
  if (chatDryPenaltyLastN.value !== '') {
    b.dryPenaltyLastN = Number(chatDryPenaltyLastN.value)
  }
  b.drySequenceBreakers = parseDryBreakersFromTextarea(dryBreakersText.value)
  if (chatFrequencyPenalty.value !== '') {
    b.frequencyPenalty = Number(chatFrequencyPenalty.value)
  }
  if (chatPresencePenalty.value !== '') {
    b.presencePenalty = Number(chatPresencePenalty.value)
  }
  b.customParamsJson = chatCustomParamsJson.value
  return b
}

const effectiveDisplay = computed((): ResolvedConversationChatDisplay | null => {
  const preset = selectedPreset.value
  if (!preset) return null
  return mergePresetWithChatBinding(preset, bindingFromForm())
})

function loadChatFormFromMerged(merged: ResolvedConversationChatDisplay) {
  chatModel.value = merged.model
  chatContextLength.value = optionalNumToField(merged.contextLength)
  chatMaxTokens.value = optionalNumToField(merged.maxTokens)
  chatStream.value = merged.stream
  chatRequestReasoning.value = merged.requestReasoningChain
  chatShowReasoning.value = merged.showReasoningChain
  chatTemperature.value = optionalNumToField(merged.temperature)
  chatTopP.value = optionalNumToField(merged.topP)
  chatTopK.value = optionalNumToField(merged.topK)
  chatDryMultiplier.value = optionalNumToField(merged.dryMultiplier)
  chatDryBase.value = optionalNumToField(merged.dryBase)
  chatDryAllowedLength.value = optionalNumToField(merged.dryAllowedLength)
  chatDryPenaltyLastN.value = optionalNumToField(merged.dryPenaltyLastN)
  dryBreakersText.value = formatDryBreakersForTextarea(merged.drySequenceBreakers)
  chatFrequencyPenalty.value = optionalNumToField(merged.frequencyPenalty)
  chatPresencePenalty.value = optionalNumToField(merged.presencePenalty)
  chatCustomParamsJson.value = merged.customParamsJson
}

function loadChatFormFromPresetAndBinding(
  preset: ApiPreset,
  binding?: ConversationChatBinding | null,
) {
  loadChatFormFromMerged(mergePresetWithChatBinding(preset, binding))
}

function prefillChatDraftFromGlobal() {
  const gp = globalPreset.value
  if (!gp) return
  chatPresetSelect.value = INHERIT
  loadChatFormFromPresetAndBinding(gp, null)
}

function prefillEmbeddingDraftFromGlobal() {
  embeddingModel.value = props.globalEmbeddingModel
  embeddingDimensions.value = props.globalEmbeddingDimensions ?? ''
}

function syncFromProps() {
  const gp = globalPreset.value
  if (!gp) return
  if (props.chatUseGlobal) {
    chatPresetSelect.value = INHERIT
    loadChatFormFromPresetAndBinding(gp, null)
  } else {
    const b = props.chatBinding
    chatPresetSelect.value = b?.apiConfigId?.trim() || INHERIT
    const basePreset =
      b?.apiConfigId && presets.value.find((x) => x.id === b.apiConfigId)
        ? presets.value.find((x) => x.id === b.apiConfigId)!
        : gp
    loadChatFormFromPresetAndBinding(basePreset, b)
  }
  if (props.embeddingUseGlobal) {
    prefillEmbeddingDraftFromGlobal()
  } else {
    embeddingModel.value =
      props.embeddingOverride?.embeddingModel?.trim() ||
      props.globalEmbeddingModel
    embeddingDimensions.value =
      props.embeddingOverride?.embeddingDimensions ??
      props.globalEmbeddingDimensions ??
      ''
  }
  lastChatBindingJson = ''
  lastEmbeddingPatchJson = ''
}

watch(
  () => [
    props.allowPropSync !== false,
    props.chatUseGlobal,
    props.chatBinding,
    props.embeddingUseGlobal,
    props.embeddingOverride,
    props.globalEmbeddingModel,
    props.globalEmbeddingDimensions,
    presets.value.length,
  ],
  () => {
    if (props.allowPropSync !== false) syncFromProps()
  },
  { immediate: true },
)

function onChatUseGlobalChange(useGlobal: boolean | null) {
  if (useGlobal === null) return
  emit('update:chatUseGlobal', useGlobal)
  if (useGlobal) {
    emit('saveChat', null)
  } else {
    prefillChatDraftFromGlobal()
  }
}

function onEmbeddingUseGlobalChange(useGlobal: boolean | null) {
  if (useGlobal === null) return
  emit('update:embeddingUseGlobal', useGlobal)
  if (useGlobal) {
    emit('saveEmbedding', null)
  } else {
    prefillEmbeddingDraftFromGlobal()
  }
}

function flushChatSave() {
  if (props.chatUseGlobal) return
  const preset = selectedPreset.value
  if (!preset || !effectiveDisplay.value) return
  const binding = buildChatBindingPatch(
    preset,
    effectiveDisplay.value,
    chatPresetSelect.value === INHERIT,
  )
  if (binding == null) return
  const snap = JSON.stringify(binding)
  if (snap === lastChatBindingJson) return
  lastChatBindingJson = snap
  emit('saveChat', binding)
}

function scheduleChatSave() {
  if (props.chatUseGlobal) return
  if (chatSaveTimer) clearTimeout(chatSaveTimer)
  chatSaveTimer = setTimeout(() => {
    chatSaveTimer = null
    flushChatSave()
  }, SAVE_DEBOUNCE_MS)
}

function flushEmbeddingSave() {
  if (props.embeddingUseGlobal) return
  const gModel = props.globalEmbeddingModel.trim()
  const gDims = props.globalEmbeddingDimensions
  const model = embeddingModel.value.trim()
  const dimsRaw = embeddingDimensions.value
  const dims =
    dimsRaw === '' || dimsRaw === null
      ? null
      : normalizeEmbeddingDimensions(Number(dimsRaw))
  const patch: ConversationEmbeddingApiSettingsOverride = {}
  if (model && model !== gModel) patch.embeddingModel = model
  if (dims !== gDims) patch.embeddingDimensions = dims
  if (Object.keys(patch).length === 0) return
  const snap = JSON.stringify(patch)
  if (snap === lastEmbeddingPatchJson) return
  lastEmbeddingPatchJson = snap
  emit('saveEmbedding', patch)
}

function scheduleEmbeddingSave() {
  if (props.embeddingUseGlobal) return
  if (embeddingSaveTimer) clearTimeout(embeddingSaveTimer)
  embeddingSaveTimer = setTimeout(() => {
    embeddingSaveTimer = null
    flushEmbeddingSave()
  }, SAVE_DEBOUNCE_MS)
}

onUnmounted(() => {
  if (chatSaveTimer) clearTimeout(chatSaveTimer)
  if (embeddingSaveTimer) clearTimeout(embeddingSaveTimer)
  flushChatSave()
  flushEmbeddingSave()
})
</script>

<template>
  <div class="conv-api-settings">
    <div class="conv-api-settings__field">
      <v-switch
        :model-value="chatUseGlobal"
        :label="$t('chat.convSettings.chatApiUseGlobal')"
        color="primary"
        hide-details
        :disabled="disabled"
        @update:model-value="onChatUseGlobalChange"
      />
    </div>

    <template v-if="!chatUseGlobal">
      <div class="conv-api-settings__field">
        <v-select
          v-model="chatPresetSelect"
          :items="presetItems"
          item-title="title"
          item-value="value"
          :label="$t('chat.convSettings.chatApiPreset')"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          :disabled="disabled"
          @update:model-value="scheduleChatSave"
        />
      </div>

      <div class="conv-api-settings__field">
        <v-text-field
          :model-value="chatModel"
          :label="$t('conn.modelId')"
          :hint="$t('conn.modelHint')"
          persistent-hint
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          readonly
          append-inner-icon="mdi-menu-down"
          class="conv-api-settings__model-field"
          :disabled="disabled"
          @click="openModelPicker"
          @click:append-inner.stop="openModelPicker"
        />
      </div>

      <ApiModelPickerDialog
        v-model="modelPickerOpen"
        :model-id="chatModel"
        :api-preset-id="modelPickerPresetId"
        @update:model-id="onModelPicked"
      />

      <v-divider class="conv-api-settings__divider" />
      <p class="conv-api-settings__group-label">
        {{ $t('conn.generationParams') }}
      </p>

      <div class="conv-api-settings__field">
        <v-text-field
          v-model="chatContextLength"
          type="number"
          :label="$t('conn.contextLength')"
          :hint="$t('conn.contextLengthHint')"
          persistent-hint
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          min="0"
          step="1"
          :disabled="disabled"
          @update:model-value="scheduleChatSave"
        />
      </div>

      <div class="conv-api-settings__field">
        <v-text-field
          v-model="chatMaxTokens"
          type="number"
          :label="$t('conn.maxTokens')"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          min="1"
          step="1"
          :disabled="disabled"
          @update:model-value="scheduleChatSave"
        />
      </div>

      <div class="conv-api-settings__field">
        <v-switch
          v-model="chatStream"
          :label="$t('conn.stream')"
          color="primary"
          hide-details
          :disabled="disabled"
          @update:model-value="scheduleChatSave"
        />
      </div>

      <div class="conv-api-settings__field">
        <v-switch
          v-model="chatRequestReasoning"
          :label="$t('conn.requestReasoningChain')"
          :hint="$t('conn.requestReasoningChainHint')"
          persistent-hint
          color="primary"
          density="comfortable"
          :disabled="disabled"
          @update:model-value="scheduleChatSave"
        />
      </div>

      <div class="conv-api-settings__field">
        <v-switch
          v-model="chatShowReasoning"
          :label="$t('conn.showReasoningChain')"
          :hint="$t('conn.showReasoningChainHint')"
          persistent-hint
          color="primary"
          density="comfortable"
          :disabled="disabled"
          @update:model-value="scheduleChatSave"
        />
      </div>

      <div class="conv-api-settings__field">
        <v-text-field
          v-model="chatTemperature"
          type="number"
          step="0.1"
          min="0"
          max="2"
          :label="$t('conn.temperature')"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          :disabled="disabled"
          @update:model-value="scheduleChatSave"
        />
      </div>

      <div class="conv-api-settings__field">
        <v-text-field
          v-model="chatTopP"
          type="number"
          step="0.05"
          min="0"
          max="1"
          :label="$t('conn.topP')"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          :disabled="disabled"
          @update:model-value="scheduleChatSave"
        />
      </div>

      <div class="conv-api-settings__field">
        <v-text-field
          v-model="chatTopK"
          type="number"
          step="1"
          min="0"
          :label="$t('conn.topK')"
          :hint="$t('conn.topKHint')"
          persistent-hint
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          :disabled="disabled"
          @update:model-value="scheduleChatSave"
        />
      </div>

      <v-expansion-panels
        variant="accordion"
        class="conv-api-settings__expansion"
      >
        <v-expansion-panel>
          <v-expansion-panel-title>
            {{ $t('conn.drySection') }}
          </v-expansion-panel-title>
          <v-expansion-panel-text>
            <p class="conv-api-settings__group-hint">
              {{ $t('conn.dryHint') }}
            </p>
            <div class="conv-api-settings__field">
              <v-text-field
                v-model="chatDryMultiplier"
                type="number"
                step="0.1"
                :label="$t('conn.dryMultiplier')"
                density="comfortable"
                variant="outlined"
                hide-details="auto"
                :disabled="disabled"
                @update:model-value="scheduleChatSave"
              />
            </div>
            <div class="conv-api-settings__field">
              <v-text-field
                v-model="chatDryBase"
                type="number"
                step="0.01"
                :label="$t('conn.dryBase')"
                density="comfortable"
                variant="outlined"
                hide-details="auto"
                :disabled="disabled"
                @update:model-value="scheduleChatSave"
              />
            </div>
            <div class="conv-api-settings__field">
              <v-text-field
                v-model="chatDryAllowedLength"
                type="number"
                step="1"
                min="0"
                :label="$t('conn.dryAllowedLength')"
                density="comfortable"
                variant="outlined"
                hide-details="auto"
                :disabled="disabled"
                @update:model-value="scheduleChatSave"
              />
            </div>
            <div class="conv-api-settings__field">
              <v-text-field
                v-model="chatDryPenaltyLastN"
                type="number"
                step="1"
                min="0"
                :label="$t('conn.dryPenaltyLastN')"
                :hint="$t('conn.dryPenaltyLastNHint')"
                persistent-hint
                density="comfortable"
                variant="outlined"
                hide-details="auto"
                :disabled="disabled"
                @update:model-value="scheduleChatSave"
              />
            </div>
            <div class="conv-api-settings__field">
              <v-textarea
                v-model="dryBreakersText"
                :label="$t('conn.drySequenceBreakers')"
                :hint="$t('conn.drySequenceBreakersHint')"
                persistent-hint
                variant="outlined"
                rows="4"
                auto-grow
                spellcheck="false"
                :disabled="disabled"
                @blur="flushChatSave"
              />
            </div>
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>

      <div class="conv-api-settings__field">
        <v-text-field
          v-model="chatFrequencyPenalty"
          type="number"
          step="0.1"
          min="-2"
          max="2"
          :label="$t('conn.frequencyPenalty')"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          :disabled="disabled"
          @update:model-value="scheduleChatSave"
        />
      </div>

      <div class="conv-api-settings__field">
        <v-text-field
          v-model="chatPresencePenalty"
          type="number"
          step="0.1"
          min="-2"
          max="2"
          :label="$t('conn.presencePenalty')"
          density="comfortable"
          variant="outlined"
          hide-details="auto"
          :disabled="disabled"
          @update:model-value="scheduleChatSave"
        />
      </div>

      <div class="conv-api-settings__field">
        <v-textarea
          v-model="chatCustomParamsJson"
          :label="$t('conn.customParams')"
          variant="outlined"
          rows="4"
          auto-grow
          spellcheck="false"
          :disabled="disabled"
          @blur="flushChatSave"
        />
      </div>
    </template>

    <div class="conv-api-settings__subsection">
      <h4 class="conv-api-settings__subsection-title">
        {{ $t('chat.convSettings.embeddingApiSection') }}
      </h4>
      <div class="conv-api-settings__field">
        <v-switch
          :model-value="embeddingUseGlobal"
          :label="$t('chat.convSettings.embeddingApiUseGlobal')"
          color="primary"
          hide-details
          :disabled="disabled"
          @update:model-value="onEmbeddingUseGlobalChange"
        />
      </div>
      <template v-if="!embeddingUseGlobal">
        <div class="conv-api-settings__field">
          <v-text-field
            v-model="embeddingModel"
            :label="$t('settings.embeddingModel')"
            density="comfortable"
            variant="outlined"
            hide-details="auto"
            :disabled="disabled"
            @blur="flushEmbeddingSave"
          />
        </div>
        <div class="conv-api-settings__field">
          <v-text-field
            v-model="embeddingDimensions"
            type="number"
            :label="$t('settings.embeddingDimensions')"
            density="comfortable"
            variant="outlined"
            hide-details="auto"
            :hint="$t('settings.embeddingDimensionsHint')"
            persistent-hint
            :disabled="disabled"
            @update:model-value="scheduleEmbeddingSave"
          />
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.conv-api-settings__field + .conv-api-settings__field,
.conv-api-settings__group-label + .conv-api-settings__field,
.conv-api-settings__divider + .conv-api-settings__field,
.conv-api-settings__expansion + .conv-api-settings__field {
  margin-top: 0.875rem;
}

.conv-api-settings__divider {
  margin-top: 1rem;
}

.conv-api-settings__group-label {
  margin: 0.75rem 0 0;
  font-size: 0.8125rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.72);
}

.conv-api-settings__group-hint {
  margin: 0 0 0.75rem;
  font-size: 0.75rem;
  line-height: 1.4;
  color: rgba(var(--v-theme-on-surface), 0.58);
}

.conv-api-settings__expansion {
  margin-top: 0.875rem;
}

.conv-api-settings__subsection {
  margin-top: 1.25rem;
  padding-top: 1rem;
  border-top: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.12);
}

.conv-api-settings__subsection-title {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgba(var(--v-theme-on-surface), 0.78);
}

.conv-api-settings__model-field :deep(.v-field) {
  cursor: pointer;
}
</style>
