<script setup lang="ts">
import ChatReasoningChain from '@/components/chat/ChatReasoningChain.vue'
import ChatTurnBranchActions from '@/components/chat/ChatTurnBranchActions.vue'
import type { useChatSession } from '@/composables/useChatSession'
import type { ChatTurnItem } from '@/types/chat-turn'
import {
  renderRichMessageToHtml,
} from '@/utils/render-rich-message'
import PluginSlotMount from '@/plugins/PluginSlotMount.vue'
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
  isAssistantBubbleLoading,
  isAssistantStreamingBubble,
  isTurnAwaitingAssistant,
  assistantReasoning,
  displayAssistantText,
  displayAssistantReasoning,
  displayStreamingAssistantText,
  displayStreamingReasoningText,
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
  <div
    class="turn turn--assistant"
    :data-turn-ordinal="turn.turnOrdinal"
  >
    <div class="turn-avatar avatar avatar--assistant" aria-hidden="true">
      <img v-if="turnAvatarUrls.assistant" :src="turnAvatarUrls.assistant" alt="" />
      <span v-else>{{ assistantAvatarLetter }}</span>
    </div>
    <div class="turn-role turn-role--assistant">
      <div class="turn-role__head">
        <span class="turn-role__label">{{ assistantRoleName }}</span>
        <span
          v-if="
            displayModelName ||
            assistantTimerLabel(turn) ||
            assistantReceiveTokenLabel(turn) ||
            isAssistantStreamingBubble(turn)
          "
          class="meta turn-role__meta"
        >
          <template v-if="displayModelName">{{ displayModelName }}</template>
          <template v-if="assistantTimerLabel(turn)">
            <template v-if="displayModelName"> · </template>
            <span
              class="turn-timer"
              :class="{ 'turn-timer--live': isAssistantBubbleLoading(turn) }"
            >
              {{ assistantTimerLabel(turn) }}
            </span>
          </template>
          <template v-if="assistantReceiveTokenLabel(turn)">
            <template v-if="displayModelName || assistantTimerLabel(turn)"> · </template>
            <span class="turn-tokens">
              {{ $t('chat.receiveTokens', { n: assistantReceiveTokenLabel(turn) }) }}
            </span>
          </template>
          <template v-if="isAssistantStreamingBubble(turn)">
            {{ $t('chat.streamingSuffix') }}
          </template>
        </span>
      </div>
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

    <ChatReasoningChain
      v-if="
        conn.showReasoningChain &&
        isAssistantBubbleLoading(turn) &&
        streamingReasoning &&
        !(editingTurnOrdinal === turn.turnOrdinal && editingSide === 'assistant')
      "
      :key="`reasoning-live-${turn.turnOrdinal}`"
      :turn-ordinal="turn.turnOrdinal"
      :reasoning-text="displayStreamingReasoningText(streamingReasoning, turn.turnOrdinal)"
      :copy-key="`r-${turn.turnOrdinal}-live`"
      :session="session"
    />

    <ChatReasoningChain
      v-if="
        conn.showReasoningChain &&
        assistantReasoning(turn).length > 0 &&
        !isAssistantBubbleLoading(turn) &&
        !(editingTurnOrdinal === turn.turnOrdinal && editingSide === 'assistant')
      "
      :key="`reasoning-${turn.turnOrdinal}`"
      :turn-ordinal="turn.turnOrdinal"
      :reasoning-text="displayAssistantReasoning(turn)"
      :copy-key="`r-${turn.turnOrdinal}`"
      :session="session"
    />

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
          v-html="renderRichMessageToHtml(displayStreamingAssistantText(streamingText, turn.turnOrdinal))"
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
          v-html="renderRichMessageToHtml(displayAssistantText(turn))"
        />
      </template>
    </div>

    <div
      v-if="!isAssistantBubbleLoading(turn)"
      class="turn-actions turn-actions--assistant"
    >
      <div class="plugin-slots" data-plugin-slot="assistant-turn-footer">
        <PluginSlotMount
          slot-name="assistant-turn-footer"
          :turn="turn"
          :list-index="listIndex"
        />
      </div>
      <div class="turn-toolbar turn-toolbar--assistant">
      <ChatTurnBranchActions
        :turn="turn"
        :disabled="regeneratingTurnOrdinal !== null || isTurnAwaitingAssistant(turn)"
      />
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
        @click="copyTurnText(displayAssistantText(turn), `a-${turn.turnOrdinal}`)"
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
