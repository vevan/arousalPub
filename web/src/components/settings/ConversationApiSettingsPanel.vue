<script setup lang="ts">
import ApiModelPickerDialog from '@/components/settings/ApiModelPickerDialog.vue'
import { useConnectionStore } from '@/stores/connection'
import {
  buildChatBindingPatch,
  buildEmbeddingOverridePatch,
  fieldToOptionalNumber,
  mergePresetWithChatBinding,
  optionalNumToField,
  resolveEmbeddingFormDraft,
  type ConversationChatBinding,
  type ConversationEmbeddingApiSettingsOverride,
  type ResolvedConversationChatDisplay,
} from '@/utils/conversation-api-settings'
import {
  formatDryBreakersForTextarea,
  parseDryBreakersFromTextarea,
} from '@/utils/dry-sampler'
import type { ApiPreset } from '@/stores/connection'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const lastChatBindingJson = ref('')
const lastEmbeddingPatchJson = ref('')

const props = withDefaults(defineProps<{
  chatUseGlobal: boolean
  chatBinding: ConversationChatBinding | null
  embeddingUseGlobal: boolean
  embeddingOverride?: ConversationEmbeddingApiSettingsOverride
  globalEmbeddingModel: string
  globalEmbeddingDimensions: number | null
  allowPropSync?: boolean
  disabled?: boolean
  autoSave?: boolean
  showEmbedding?: boolean
  showPresetSelector?: boolean
  snapshotParameters?: boolean
  showSaveButton?: boolean
}>(), {
  allowPropSync: true,
  autoSave: true,
  showEmbedding: true,
  showPresetSelector: true,
  snapshotParameters: false,
  showSaveButton: true,
})

const emit = defineEmits<{
  (
    e: 'update:chatUseGlobal',
    v: boolean,
    bindingToSave?: ConversationChatBinding,
  ): void
  (e: 'update:embeddingUseGlobal', v: boolean): void
  (e: 'saveChat', binding: ConversationChatBinding | null): void
  (e: 'saveEmbedding', patch: ConversationEmbeddingApiSettingsOverride | null): void
  (e: 'draftDirty', dirty: boolean): void
  (e: 'presetSelected', presetId: string): void
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
const draftDirty = ref(false)

function markDraftDirty(): void {
  if (draftDirty.value) return
  draftDirty.value = true
  emit('draftDirty', true)
}

const embeddingModel = ref('')
const embeddingDimensions = ref<number | ''>('')

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
  markDraftDirty()
  if (props.autoSave !== false) flushChatSave()
}

/** 空输入记为 null，避免 merge 时回填预设导致「清空又恢复」。 */
function bindingFromForm(): ConversationChatBinding {
  const b: ConversationChatBinding = {}
  if (chatPresetSelect.value && chatPresetSelect.value !== INHERIT) {
    b.apiConfigId = chatPresetSelect.value
  }
  if (chatModel.value.trim()) b.model = chatModel.value.trim()
  b.contextLength = fieldToOptionalNumber(chatContextLength.value)
  b.maxTokens = fieldToOptionalNumber(chatMaxTokens.value)
  b.stream = chatStream.value
  b.requestReasoningChain = chatRequestReasoning.value
  b.showReasoningChain = chatShowReasoning.value
  b.temperature = fieldToOptionalNumber(chatTemperature.value)
  b.topP = fieldToOptionalNumber(chatTopP.value)
  b.topK = fieldToOptionalNumber(chatTopK.value)
  b.dryMultiplier = fieldToOptionalNumber(chatDryMultiplier.value)
  b.dryBase = fieldToOptionalNumber(chatDryBase.value)
  b.dryAllowedLength = fieldToOptionalNumber(chatDryAllowedLength.value)
  b.dryPenaltyLastN = fieldToOptionalNumber(chatDryPenaltyLastN.value)
  b.drySequenceBreakers = parseDryBreakersFromTextarea(dryBreakersText.value)
  b.frequencyPenalty = fieldToOptionalNumber(chatFrequencyPenalty.value)
  b.presencePenalty = fieldToOptionalNumber(chatPresencePenalty.value)
  b.customParamsJson = chatCustomParamsJson.value
  return b
}

function fullParameterSnapshot(): ConversationChatBinding | undefined {
  const effective = effectiveDisplay.value
  if (!effective) return undefined
  const binding: ConversationChatBinding = {
    model: effective.model,
    contextLength: effective.contextLength,
    maxTokens: effective.maxTokens,
    stream: effective.stream,
    requestReasoningChain: effective.requestReasoningChain,
    showReasoningChain: effective.showReasoningChain,
    temperature: effective.temperature,
    topP: effective.topP,
    topK: effective.topK,
    dryMultiplier: effective.dryMultiplier,
    dryBase: effective.dryBase,
    dryAllowedLength: effective.dryAllowedLength,
    dryPenaltyLastN: effective.dryPenaltyLastN,
    drySequenceBreakers: effective.drySequenceBreakers,
    frequencyPenalty: effective.frequencyPenalty,
    presencePenalty: effective.presencePenalty,
    customParamsJson: effective.customParamsJson,
  }
  if (chatPresetSelect.value && chatPresetSelect.value !== INHERIT) {
    binding.apiConfigId = chatPresetSelect.value.trim()
  } else if (props.chatBinding?.apiConfigId?.trim()) {
    binding.apiConfigId = props.chatBinding.apiConfigId.trim()
  }
  return binding
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
    const draft = resolveEmbeddingFormDraft(
      props.globalEmbeddingModel,
      props.globalEmbeddingDimensions,
      props.embeddingOverride,
    )
    embeddingModel.value = draft.model
    embeddingDimensions.value = draft.dimensions
  }
  lastChatBindingJson.value = ''
  lastEmbeddingPatchJson.value = ''
  if (draftDirty.value) {
    draftDirty.value = false
    emit('draftDirty', false)
  }
}

watch(
  () => [
    props.allowPropSync !== false,
    props.chatUseGlobal,
    JSON.stringify(props.chatBinding),
    props.embeddingUseGlobal,
    JSON.stringify(props.embeddingOverride),
    props.globalEmbeddingModel,
    props.globalEmbeddingDimensions,
    activePresetId.value,
    presets.value.map((preset) => JSON.stringify(preset)).join('|'),
  ],
  () => {
    if (props.autoSave === false && draftDirty.value) return
    if (props.allowPropSync !== false) syncFromProps()
  },
  { immediate: true },
)

function onChatUseGlobalChange(useGlobal: boolean | null) {
  if (useGlobal === null) return
  // 开启继承：先把当前表单快照交给父组件落盘，父组件成功后再切 Tab，避免面板被卸载丢保存
  if (useGlobal && !props.chatUseGlobal) {
    const snap = props.snapshotParameters
      ? fullParameterSnapshot()
      : (() => {
          const preset = selectedPreset.value
          if (!preset || !effectiveDisplay.value) return undefined
          return buildChatBindingPatch(
            preset,
            effectiveDisplay.value,
            chatPresetSelect.value === INHERIT,
          )
        })()
    const inherited: ConversationChatBinding = snap
      ? { ...snap, inheritGlobal: true }
      : inheritedBinding()
    emit('update:chatUseGlobal', true, inherited)
    return
  }
  emit('update:chatUseGlobal', useGlobal)
  markDraftDirty()
  if (useGlobal) {
    if (props.autoSave !== false) emit('saveChat', inheritedBinding())
  } else {
    const binding = props.chatBinding
    const presetId = binding?.apiConfigId?.trim()
    const preset = presetId
      ? presets.value.find((item) => item.id === presetId)
      : globalPreset.value
    if (binding && preset) {
      chatPresetSelect.value = presetId || INHERIT
      loadChatFormFromPresetAndBinding(preset, binding)
    } else {
      prefillChatDraftFromGlobal()
    }
  }
}

function onChatPresetSelected(presetId: string) {
  chatPresetSelect.value = presetId
  markDraftDirty()
  emit('presetSelected', presetId)
}

function inheritedBinding(): ConversationChatBinding {
  if (!props.chatBinding) return { inheritGlobal: true }
  return { ...props.chatBinding, inheritGlobal: true }
}

function getDraftBinding(): ConversationChatBinding | null | undefined {
  if (props.chatUseGlobal) {
    return inheritedBinding()
  }
  if (props.snapshotParameters) return fullParameterSnapshot()
  const preset = selectedPreset.value
  if (!preset || !effectiveDisplay.value) return undefined
  const binding = buildChatBindingPatch(
    preset,
    effectiveDisplay.value,
    chatPresetSelect.value === INHERIT,
  )
  return binding
}

function flushChatSave() {
  if (props.autoSave === false) return
  const binding = getDraftBinding()
  if (binding == null) return
  const snap = JSON.stringify(binding)
  if (snap === lastChatBindingJson.value) return
  lastChatBindingJson.value = snap
  emit('saveChat', binding)
}

function onChatFieldEdit() {
  markDraftDirty()
}

function onChatFieldBlur() {
  if (props.autoSave !== false) flushChatSave()
}

function onChatToggleEdit() {
  markDraftDirty()
  if (props.autoSave !== false) flushChatSave()
}

function getDraftEmbedding():
  | ConversationEmbeddingApiSettingsOverride
  | null
  | undefined {
  if (props.embeddingUseGlobal) return null
  return buildEmbeddingOverridePatch(
    props.globalEmbeddingModel,
    props.globalEmbeddingDimensions,
    embeddingModel.value,
    embeddingDimensions.value,
    props.embeddingOverride,
  )
}

function saveEmbeddingDraft(): void {
  const patch = getDraftEmbedding()
  if (patch === undefined) return
  emit('saveEmbedding', patch)
}

function saveDraft(): void {
  const binding = getDraftBinding()
  if (binding !== undefined) emit('saveChat', binding)
  if (props.showEmbedding !== false) saveEmbeddingDraft()
}

function markDraftSaved(): void {
  if (!draftDirty.value) return
  draftDirty.value = false
  emit('draftDirty', false)
}

function flushEmbeddingSave() {
  if (props.autoSave === false) return
  const patch = getDraftEmbedding()
  if (patch === undefined) return
  const snap = patch === null ? 'null' : JSON.stringify(patch)
  if (snap === lastEmbeddingPatchJson.value) return
  lastEmbeddingPatchJson.value = snap
  emit('saveEmbedding', patch)
}

function onEmbeddingFieldEdit() {
  markDraftDirty()
}

function onEmbeddingFieldBlur() {
  if (props.autoSave !== false) flushEmbeddingSave()
}

function onEmbeddingUseGlobalChange(useGlobal: boolean | null) {
  if (useGlobal === null) return
  emit('update:embeddingUseGlobal', useGlobal)
  markDraftDirty()
  if (useGlobal) {
    if (props.autoSave !== false) emit('saveEmbedding', null)
  } else {
    prefillEmbeddingDraftFromGlobal()
  }
}

onUnmounted(() => {
  if (props.autoSave !== false) flushChatSave()
  if (props.autoSave !== false) flushEmbeddingSave()
})

defineExpose({
  getDraftBinding,
  getDraftEmbedding,
  saveDraft,
  saveEmbeddingDraft,
  markDraftSaved,
  syncFromProps,
  isDraftDirty: draftDirty,
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
      <div v-if="showPresetSelector !== false" class="conv-api-settings__field">
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
          @update:model-value="onChatPresetSelected"
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
          @update:model-value="onChatFieldEdit"
          @blur="onChatFieldBlur"
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
          @update:model-value="onChatFieldEdit"
          @blur="onChatFieldBlur"
        />
      </div>

      <div class="conv-api-settings__field">
        <v-switch
          v-model="chatStream"
          :label="$t('conn.stream')"
          color="primary"
          hide-details
          :disabled="disabled"
          @update:model-value="onChatToggleEdit"
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
          @update:model-value="onChatToggleEdit"
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
          @update:model-value="onChatToggleEdit"
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
          @update:model-value="onChatFieldEdit"
          @blur="onChatFieldBlur"
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
          @update:model-value="onChatFieldEdit"
          @blur="onChatFieldBlur"
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
          @update:model-value="onChatFieldEdit"
          @blur="onChatFieldBlur"
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
                @update:model-value="onChatFieldEdit"
                @blur="onChatFieldBlur"
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
                @update:model-value="onChatFieldEdit"
                @blur="onChatFieldBlur"
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
                @update:model-value="onChatFieldEdit"
                @blur="onChatFieldBlur"
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
                @update:model-value="onChatFieldEdit"
                @blur="onChatFieldBlur"
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
                @update:model-value="onChatFieldEdit"
                @blur="onChatFieldBlur"
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
          @update:model-value="onChatFieldEdit"
          @blur="onChatFieldBlur"
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
          @update:model-value="onChatFieldEdit"
          @blur="onChatFieldBlur"
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
          @update:model-value="onChatFieldEdit"
          @blur="onChatFieldBlur"
        />
      </div>
      <v-btn
      v-if="autoSave === false && showSaveButton !== false"
        block
        color="primary"
        variant="flat"
        class="mt-4"
        :disabled="disabled"
        @click="saveDraft"
      >
        {{ $t('conn.saveConversationParameters') }}
      </v-btn>
    </template>

    <v-btn
      v-if="autoSave === false && chatUseGlobal && showSaveButton !== false"
      block
      color="primary"
      variant="flat"
      class="mt-4"
      :disabled="disabled"
      @click="saveDraft"
    >
      {{ $t('conn.saveConversationParameters') }}
    </v-btn>

    <div v-if="showEmbedding !== false" class="conv-api-settings__subsection">
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
            @update:model-value="onEmbeddingFieldEdit"
            @blur="onEmbeddingFieldBlur"
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
            @update:model-value="onEmbeddingFieldEdit"
            @blur="onEmbeddingFieldBlur"
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
