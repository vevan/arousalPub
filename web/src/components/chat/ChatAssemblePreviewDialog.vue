<script setup lang="ts">
import type { useChatSession } from '@/composables/useChatSession'
import { computed, toRefs } from 'vue'

const props = defineProps<{
  session: ReturnType<typeof useChatSession>
}>()

const {
  assemblePreviewOpen,
  assemblePreviewLoading,
  assemblePreviewError,
  assemblePreviewJson,
  assemblePreviewMeta,
  assemblePreviewCopied,
  assemblePreviewRawCopied,
} = toRefs(props.session)

const { copyAssemblePreviewJson, copyAssemblePreviewRaw } = props.session

const hasBudgetDrops = computed(() => {
  const m = assemblePreviewMeta.value
  return (
    m.droppedLoreCount > 0 ||
    m.droppedMemoryCount > 0 ||
    m.droppedHistoryCount > 0
  )
})
</script>

<template>
<v-dialog
    v-model="assemblePreviewOpen"
    scrollable
    max-width="52rem"
  >
    <v-card class="preview-card">
      <v-card-title class="preview-card__title">
        <span>{{ $t('chat.previewAssembleTitle') }}</span>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          density="comfortable"
          @click="assemblePreviewOpen = false"
        />
      </v-card-title>
      <p class="preview-card__lede text-body-2 text-medium-emphasis px-4 pb-2 mb-0">
        {{ $t('chat.previewAssembleHint') }}
      </p>
      <div
        v-if="!assemblePreviewLoading && !assemblePreviewError"
        class="preview-card__topbar"
      >
        <span class="preview-card__meta">
          <span class="preview-card__meta-label">{{ $t('prompts.previewMessagesLabel') }}</span>
          {{ assemblePreviewMeta.messages }}
        </span>
        <span class="preview-card__meta">
          <span class="preview-card__meta-label">{{ $t('prompts.previewTokensLabel') }}</span>
          {{ assemblePreviewMeta.estimatedTokens }}
        </span>
        <span
          v-if="assemblePreviewMeta.memoryTurnIds.length > 0"
          class="preview-card__meta"
        >
          <span class="preview-card__meta-label">{{ $t('chat.previewMemoryTurns') }}</span>
          {{ assemblePreviewMeta.memoryTurnIds.length }}
        </span>
      </div>
      <div
        v-if="!assemblePreviewLoading && !assemblePreviewError && hasBudgetDrops"
        class="preview-card__topbar preview-card__topbar--drops"
      >
        <span class="preview-card__meta-label">{{ $t('prompts.previewDroppedLabel') }}</span>
        <span
          v-if="assemblePreviewMeta.droppedLoreCount > 0"
          class="preview-card__meta preview-card__meta--warn"
        >
          {{ $t('prompts.previewDroppedLore', { n: assemblePreviewMeta.droppedLoreCount }) }}
        </span>
        <span
          v-if="assemblePreviewMeta.droppedMemoryCount > 0"
          class="preview-card__meta preview-card__meta--warn"
        >
          {{ $t('prompts.previewDroppedMemory', { n: assemblePreviewMeta.droppedMemoryCount }) }}
        </span>
        <span
          v-if="assemblePreviewMeta.droppedHistoryCount > 0"
          class="preview-card__meta preview-card__meta--warn"
        >
          {{ $t('prompts.previewDropped', { n: assemblePreviewMeta.droppedHistoryCount }) }}
        </span>
      </div>
      <v-card-text class="preview-card__body">
        <v-progress-linear
          v-if="assemblePreviewLoading"
          indeterminate
          class="mb-2 rounded"
          color="primary"
        />
        <v-alert
          v-else-if="assemblePreviewError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-0"
        >
          {{ assemblePreviewError }}
        </v-alert>
        <pre
          v-else-if="assemblePreviewJson"
          class="preview-card__json"
        >{{ assemblePreviewJson }}</pre>
      </v-card-text>
      <v-card-actions class="preview-card__foot">
        <v-spacer />
        <template v-if="assemblePreviewJson && !assemblePreviewError">
          <button
            type="button"
            class="editor-card__btn"
            :class="{ 'is-flash': assemblePreviewCopied }"
            @click="copyAssemblePreviewJson"
          >
            {{
              assemblePreviewCopied
                ? $t('prompts.previewCopied')
                : $t('prompts.previewCopy')
            }}
          </button>
          <button
            type="button"
            class="editor-card__btn"
            :class="{ 'is-flash': assemblePreviewRawCopied }"
            @click="copyAssemblePreviewRaw"
          >
            {{
              assemblePreviewRawCopied
                ? $t('prompts.previewCopied')
                : $t('prompts.previewCopyRaw')
            }}
          </button>
        </template>
        <v-btn
          variant="text"
          @click="assemblePreviewOpen = false"
        >
          {{ $t('prompts.previewClose') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
