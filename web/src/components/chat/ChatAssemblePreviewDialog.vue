<script setup lang="ts">
import AssembledMessagesPanel from '@/components/prompts/AssembledMessagesPanel.vue'
import type { useChatSession } from '@/composables/useChatSession'
import {
  CHAT_CONVERSATION_ACTIONS_KEY,
} from '@/composables/chat-conversation-actions'
import { computed, inject, toRefs } from 'vue'

const props = defineProps<{
  session: ReturnType<typeof useChatSession>
}>()

const {
  assemblePreviewOpen,
  assemblePreviewLoading,
  assemblePreviewError,
  assemblePreviewMemoryCorrupt,
  assemblePreviewMessages,
  assemblePreviewMeta,
  assemblePreviewCopied,
  assemblePreviewRawCopied,
} = toRefs(props.session)

const {
  copyAssemblePreviewJson,
  copyAssemblePreviewRaw,
  closeAssemblePreview,
} = props.session

const conversationActions = inject(CHAT_CONVERSATION_ACTIONS_KEY, null)

const hasBudgetDrops = computed(() => {
  const m = assemblePreviewMeta.value
  return (
    m.droppedLoreCount > 0 ||
    m.droppedMemoryCount > 0 ||
    m.droppedHistoryCount > 0
  )
})

function onJumpMemoryRebuild() {
  closeAssemblePreview()
  conversationActions?.openMemoryRebuild()
}
</script>

<template>
  <v-dialog
    v-model="assemblePreviewOpen"
    scrollable
    max-width="52rem"
    :persistent="assemblePreviewMemoryCorrupt"
  >
    <v-card class="preview-card">
      <v-card-title class="preview-card__title">
        <span>{{ $t('chat.previewAssembleTitle') }}</span>
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          density="comfortable"
          @click="closeAssemblePreview"
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
          class="mb-0"
        >
          <p class="mb-0">
            {{ assemblePreviewError }}
          </p>
          <p
            v-if="assemblePreviewMemoryCorrupt"
            class="text-body-2 text-medium-emphasis mb-0 mt-2"
          >
            {{ $t('chat.previewAssembleMemoryRebuildHint') }}
          </p>
        </v-alert>
        <AssembledMessagesPanel
          v-else-if="assemblePreviewMessages.length > 0"
          :messages="assemblePreviewMessages"
        />
      </v-card-text>
      <v-card-actions class="preview-card__foot">
        <template v-if="assemblePreviewError">
          <v-btn
            v-if="assemblePreviewMemoryCorrupt"
            color="primary"
            variant="flat"
            class="text-none"
            @click="onJumpMemoryRebuild"
          >
            {{ $t('chat.previewAssembleMemoryRebuildAction') }}
          </v-btn>
          <v-spacer />
          <v-btn
            variant="text"
            class="text-none"
            @click="closeAssemblePreview"
          >
            {{ $t('chat.previewAssembleErrorClose') }}
          </v-btn>
        </template>
        <template v-else>
          <v-spacer />
          <template v-if="assemblePreviewMessages.length > 0">
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
            @click="closeAssemblePreview"
          >
            {{ $t('prompts.previewClose') }}
          </v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
