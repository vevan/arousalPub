<script setup lang="ts">
import type { useChatSession } from '@/composables/useChatSession'
import type { ChatTurnItem } from '@/types/chat-turn'
import {
  renderReasoningMarkdownToHtml,
  renderRichMessageToHtml,
} from '@/utils/render-rich-message'
import { useConnectionStore } from '@/stores/connection'
import { storeToRefs } from 'pinia'
import { computed, toRefs } from 'vue'

const props = defineProps<{
  turn: ChatTurnItem
  listIndex: number
  session: ReturnType<typeof useChatSession>
}>()

const conn = useConnectionStore()
const { model: connModel } = storeToRefs(conn)

const {
  streamingText,
  streamingReasoning,
  editingTurnOrdinal,
  editingSide,
  editDraft,
  regeneratingTurnOrdinal,
  turnAvatarUrls,
  copiedTurnKey,
  writeChatPromptSnapshot,
} = toRefs(props.session)

const {
  turnLabelN,
  isAssistantBubbleLoading,
  isAssistantStreamingBubble,
  assistantReasoning,
  assistantText,
  reasoningCharsCount,
  showAssistantSwipeFooter,
  slideAssistant,
  regenerateAssistant,
  openEditAssistant,
  cancelEdit,
  saveEdit,
  requestDelete,
  copyTurnText,
  openTurnPromptSnapshot,
  assistantTimerLabel,
  assistantReceiveTokenLabel,
} = props.session

const { assistantRoleName, assistantAvatarLetter } = toRefs(props.session)

const displayModelName = computed(() => {
  const t = props.turn
  if (isAssistantBubbleLoading(t)) {
    return connModel.value.trim()
  }
  const idx = t.activeReceiveIndex
  const r = t.receives[idx]
  const stored =
    typeof r?.model === 'string' && r.model.trim() ? r.model.trim() : ''
  return stored || connModel.value.trim()
})
</script>

<template>
  <div class="turn turn--assistant">
    <div class="turn-avatar avatar avatar--assistant" aria-hidden="true">
      <img v-if="turnAvatarUrls.assistant" :src="turnAvatarUrls.assistant" alt="" />
      <span v-else>{{ assistantAvatarLetter }}</span>
    </div>
    <div class="turn-role turn-role--assistant">
      <span class="turn-role__label">
        {{ assistantRoleName }}
        <span class="meta">
          {{ $t('chat.turnLabel', { n: turnLabelN(turn, listIndex) }) }}
          <template v-if="displayModelName"> · {{ displayModelName }}</template>
          <template v-if="assistantTimerLabel(turn)">
            ·
            <span
              class="turn-timer"
              :class="{ 'turn-timer--live': isAssistantBubbleLoading(turn) }"
            >
              {{ assistantTimerLabel(turn) }}
            </span>
          </template>
          <template v-if="assistantReceiveTokenLabel(turn)">
            ·
            <span class="turn-tokens">
              {{ $t('chat.receiveTokens', { n: assistantReceiveTokenLabel(turn) }) }}
            </span>
          </template>
          <template v-if="isAssistantStreamingBubble(turn)">
            {{ $t('chat.streamingSuffix') }}
          </template>
        </span>
      </span>
      <div class="plugin-slots" data-plugin-slot="assistant-turn">
        <button
          type="button"
          class="plugin-slot"
          :class="{
            'is-filled':
              (conn.showReasoningChain && assistantReasoning(turn).length > 0) ||
              (isAssistantBubbleLoading(turn) && !!streamingReasoning),
          }"
          :data-tt="$t('chat.pluginIndicatorReasoning')"
          :aria-label="$t('chat.pluginIndicatorReasoning')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M9 11a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
            <path d="M17.657 16.657L13.414 20.9a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z" />
          </svg>
        </button>
        <button
          type="button"
          class="plugin-slot"
          :class="{ 'is-filled': isAssistantStreamingBubble(turn) }"
          :data-tt="$t('chat.pluginIndicatorStream')"
          :aria-label="$t('chat.pluginIndicatorStream')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
            <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
          </svg>
        </button>
        <button
          type="button"
          class="plugin-slot"
          :data-tt="$t('chat.pluginPlaceholderTts')"
          :aria-label="$t('chat.pluginPlaceholderTts')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
            <path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" />
          </svg>
        </button>
        <button
          type="button"
          class="plugin-slot"
          :data-tt="$t('chat.pluginPlaceholderMore')"
          :aria-label="$t('chat.pluginPlaceholderMore')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>

    <details
      v-if="
        conn.showReasoningChain &&
        isAssistantBubbleLoading(turn) &&
        streamingReasoning &&
        !(editingTurnOrdinal === turn.turnOrdinal && editingSide === 'assistant')
      "
      class="reasoning-chain"
    >
      <summary class="reasoning-chain__summary">
        <span class="reasoning-chain__caret">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="9 6 15 12 9 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span class="reasoning-chain__title">
          {{ $t('chat.reasoningSummary') }}
          <span class="reasoning-chain__meta">
            {{ $t('chat.reasoningCharsMeta', { n: reasoningCharsCount(streamingReasoning) }) }}
          </span>
        </span>
        <span class="reasoning-chain__hint">
          <span class="reasoning-chain__hint-expand">{{ $t('chat.expand') }}</span>
          <span class="reasoning-chain__hint-collapse">{{ $t('chat.collapse') }}</span>
          <kbd>{{ $t('chat.shortcutKey') }}</kbd>
        </span>
        <button
          type="button"
          class="turn-toolbar__btn reasoning-chain__copy"
          :data-tt="copiedTurnKey === `r-${turn.turnOrdinal}-live` ? $t('chat.copied') : $t('chat.copy')"
          :class="{ 'is-success': copiedTurnKey === `r-${turn.turnOrdinal}-live` }"
          :aria-label="$t('chat.copy')"
          @click.stop="copyTurnText(streamingReasoning, `r-${turn.turnOrdinal}-live`)"
        >
          <v-icon size="14">
            {{ copiedTurnKey === `r-${turn.turnOrdinal}-live` ? 'mdi-check' : 'mdi-content-copy' }}
          </v-icon>
        </button>
      </summary>
      <div
        class="reasoning-chain__body chat-rich-text"
        v-html="renderReasoningMarkdownToHtml(streamingReasoning)"
      />
    </details>

    <details
      v-if="
        conn.showReasoningChain &&
        assistantReasoning(turn).length > 0 &&
        !isAssistantBubbleLoading(turn) &&
        !(editingTurnOrdinal === turn.turnOrdinal && editingSide === 'assistant')
      "
      class="reasoning-chain"
    >
      <summary class="reasoning-chain__summary">
        <span class="reasoning-chain__caret">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline points="9 6 15 12 9 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
        </span>
        <span class="reasoning-chain__title">
          {{ $t('chat.reasoningSummary') }}
          <span class="reasoning-chain__meta">
            {{ $t('chat.reasoningCharsMeta', { n: reasoningCharsCount(assistantReasoning(turn)) }) }}
          </span>
        </span>
        <span class="reasoning-chain__hint">
          <span class="reasoning-chain__hint-expand">{{ $t('chat.expand') }}</span>
          <span class="reasoning-chain__hint-collapse">{{ $t('chat.collapse') }}</span>
          <kbd>{{ $t('chat.shortcutKey') }}</kbd>
        </span>
        <button
          type="button"
          class="turn-toolbar__btn reasoning-chain__copy"
          :data-tt="copiedTurnKey === `r-${turn.turnOrdinal}` ? $t('chat.copied') : $t('chat.copy')"
          :class="{ 'is-success': copiedTurnKey === `r-${turn.turnOrdinal}` }"
          :aria-label="$t('chat.copy')"
          @click.stop="copyTurnText(assistantReasoning(turn), `r-${turn.turnOrdinal}`)"
        >
          <v-icon size="14">
            {{ copiedTurnKey === `r-${turn.turnOrdinal}` ? 'mdi-check' : 'mdi-content-copy' }}
          </v-icon>
        </button>
      </summary>
      <div
        class="reasoning-chain__body chat-rich-text"
        v-html="renderReasoningMarkdownToHtml(assistantReasoning(turn))"
      />
    </details>

    <div
      class="turn-bubble turn-bubble--assistant position-relative"
      :class="{
        'turn-bubble--streaming': isAssistantStreamingBubble(turn),
      }"
    >
      <template v-if="editingTurnOrdinal === turn.turnOrdinal && editingSide === 'assistant'">
        <v-textarea
          v-model="editDraft"
          rows="3"
          auto-grow
          max-rows="16"
          variant="outlined"
          density="compact"
          hide-details="auto"
          class="mb-2"
        />
        <div class="d-flex gap-2 justify-end">
          <v-btn size="small" variant="text" @click="cancelEdit">
            {{ $t('settings.themeCancel') }}
          </v-btn>
          <v-btn size="small" color="primary" variant="flat" @click="saveEdit(listIndex)">
            {{ $t('settings.themeConfirm') }}
          </v-btn>
        </div>
      </template>
      <template v-else-if="isAssistantBubbleLoading(turn)">
        <div
          v-if="isAssistantStreamingBubble(turn)"
          class="chat-rich-text"
          v-html="renderRichMessageToHtml(streamingText)"
        />
        <v-skeleton-loader
          v-else
          type="paragraph"
          class="assistant-bubble-skeleton"
          :aria-label="$t('chat.assistantLoading')"
        />
      </template>
      <template v-else>
        <div
          class="chat-rich-text"
          v-html="renderRichMessageToHtml(assistantText(turn))"
        />
      </template>
    </div>

    <div
      v-if="!isAssistantBubbleLoading(turn)"
      class="turn-actions turn-actions--assistant"
    >
      <div class="plugin-slots" data-plugin-slot="assistant-turn-footer" />
      <div class="turn-toolbar turn-toolbar--assistant">
      <button
        type="button"
        class="turn-toolbar__btn"
        :disabled="regeneratingTurnOrdinal !== null"
        :data-tt="$t('chat.edit')"
        :aria-label="$t('chat.edit')"
        @click="openEditAssistant(turn)"
      >
        <v-icon size="16">mdi-pencil-outline</v-icon>
      </button>
      <button
        type="button"
        class="turn-toolbar__btn"
        :disabled="regeneratingTurnOrdinal !== null || !turn.user.trim()"
        :data-tt="$t('chat.regenerate')"
        :aria-label="$t('chat.regenerate')"
        @click="regenerateAssistant(listIndex)"
      >
        <v-icon size="16">mdi-refresh</v-icon>
      </button>
      <button
        type="button"
        class="turn-toolbar__btn"
        :data-tt="copiedTurnKey === `a-${turn.turnOrdinal}` ? $t('chat.copied') : $t('chat.copy')"
        :class="{ 'is-success': copiedTurnKey === `a-${turn.turnOrdinal}` }"
        :aria-label="$t('chat.copy')"
        @click="copyTurnText(assistantText(turn), `a-${turn.turnOrdinal}`)"
      >
        <v-icon size="16">{{ copiedTurnKey === `a-${turn.turnOrdinal}` ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
      </button>
      <button
        v-if="writeChatPromptSnapshot"
        type="button"
        class="turn-toolbar__btn"
        :disabled="regeneratingTurnOrdinal !== null"
        :data-tt="$t('chat.viewTurnPrompt')"
        :aria-label="$t('chat.viewTurnPrompt')"
        @click="openTurnPromptSnapshot(turn)"
      >
        <v-icon size="16">mdi-text-box-search-outline</v-icon>
      </button>
      <button
        type="button"
        class="turn-toolbar__btn turn-toolbar__btn--danger"
        :disabled="regeneratingTurnOrdinal !== null"
        :data-tt="$t('chat.delete')"
        :aria-label="$t('chat.delete')"
        @click="requestDelete(listIndex)"
      >
        <v-icon size="16">mdi-delete-outline</v-icon>
      </button>
      <div
        v-if="showAssistantSwipeFooter(turn, listIndex)"
        class="swipe"
        :aria-label="
          $t('chat.swipePosition', {
            current: turn.activeReceiveIndex + 1,
            total: turn.receives.length,
          })
        "
      >
        <button
          type="button"
          class="swipe__btn"
          :disabled="regeneratingTurnOrdinal !== null"
          :aria-label="$t('chat.prevAssistant')"
          @click="slideAssistant(listIndex, 'left')"
        >
          <v-icon size="16">mdi-chevron-left</v-icon>
        </button>
        <span class="swipe__count tabular-nums">
          {{ turn.activeReceiveIndex + 1 }} / {{ turn.receives.length }}
        </span>
        <button
          type="button"
          class="swipe__btn"
          :disabled="regeneratingTurnOrdinal !== null"
          :aria-label="$t('chat.nextAssistant')"
          @click="slideAssistant(listIndex, 'right')"
        >
          <v-icon size="16">mdi-chevron-right</v-icon>
        </button>
      </div>
      </div>
    </div>
  </div>
</template>
