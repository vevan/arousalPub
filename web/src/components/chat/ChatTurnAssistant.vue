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
  segmentIndex?: number
  session: ReturnType<typeof useChatSession>
}>()

const conn = useConnectionStore()
const { model: connModel } = storeToRefs(conn)

const {
  streamingText,
  streamingReasoning,
  editDraft,
  regeneratingTurnOrdinal,
  copiedTurnKey,
  writeChatPromptSnapshot,
  generationTimerTick,
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
  isEditingAssistantSegment,
} = props.session

const segIdx = computed(() => props.segmentIndex ?? 0)
const copyKey = computed(() => `a-${props.turn.turnOrdinal}-${segIdx.value}`)

function bubbleLoading() {
  return isAssistantBubbleLoading(props.turn, segIdx.value)
}
function bubbleStreaming() {
  return isAssistantStreamingBubble(props.turn, segIdx.value)
}
function bubbleEditing() {
  return isEditingAssistantSegment(props.turn.turnOrdinal, segIdx.value)
}

const liveAssistantTimerLabel = computed(() => {
  void generationTimerTick.value
  return assistantTimerLabel(props.turn, segIdx.value)
})

const displayModelName = computed(() => {
  const t = props.turn
  if (bubbleLoading()) {
    return connModel.value.trim()
  }
  const idx = t.activeReceiveIndex
  const r = t.receives[idx]
  const stored =
    typeof r?.model === 'string' && r.model.trim() ? r.model.trim() : ''
  return stored || connModel.value.trim()
})

const speakerRoleName = computed(() =>
  props.session.assistantRoleNameForSpeaker(props.turn.speakerCharacterId),
)
const speakerAvatarUrl = computed(() =>
  props.session.assistantAvatarUrlForSpeaker(props.turn.speakerCharacterId),
)
const speakerAvatarLetter = computed(() =>
  props.session.assistantAvatarLetterForSpeaker(props.turn.speakerCharacterId),
)
</script>

<template>
  <div
    class="turn turn--assistant"
    :data-turn-ordinal="turn.turnOrdinal"
  >
    <div class="turn-avatar avatar avatar--assistant" aria-hidden="true">
      <img v-if="speakerAvatarUrl" :src="speakerAvatarUrl" alt="" />
      <span v-else>{{ speakerAvatarLetter }}</span>
    </div>
    <div class="turn-role turn-role--assistant">
      <span class="turn-role__label">{{ speakerRoleName }}</span>
      <div class="plugin-slots" data-plugin-slot="assistant-turn">
        <PluginSlotMount
          slot-name="assistant-turn"
          :turn="turn"
          :list-index="listIndex"
          :segment-index="segmentIndex"
        />
      </div>
      <div class="turn-role__trail">
        <span
          v-if="
            displayModelName ||
            liveAssistantTimerLabel ||
            assistantReceiveTokenLabel(turn, segIdx) ||
            bubbleStreaming()
          "
          class="meta turn-role__meta"
        >
          <template v-if="displayModelName">{{ displayModelName }}</template>
          <template v-if="liveAssistantTimerLabel">
            <template v-if="displayModelName"> · </template>
            <span
              class="turn-timer"
              :class="{ 'turn-timer--live': bubbleLoading() }"
            >
              {{ liveAssistantTimerLabel }}
            </span>
          </template>
          <template v-if="assistantReceiveTokenLabel(turn, segIdx)">
            <template v-if="displayModelName || liveAssistantTimerLabel"> · </template>
            <span class="turn-tokens">
              {{ $t('chat.receiveTokens', { n: assistantReceiveTokenLabel(turn, segIdx) }) }}
            </span>
          </template>
          <template v-if="bubbleStreaming()">
            {{ $t('chat.streamingSuffix') }}
          </template>
        </span>
        <div class="turn-role__indicators" aria-label="Turn status">
          <span
            v-if="conn.showReasoningChain"
            class="turn-role__indicator"
            :class="{
              'is-filled':
                assistantReasoning(turn).length > 0 ||
                (bubbleLoading() && !!streamingReasoning),
            }"
            role="img"
            :data-tt="$t('chat.pluginIndicatorReasoning')"
            :aria-label="$t('chat.pluginIndicatorReasoning')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M9 11a3 3 0 1 0 6 0a3 3 0 1 0 -6 0" />
              <path d="M17.657 16.657L13.414 20.9a2 2 0 0 1 -2.827 0l-4.244 -4.243a8 8 0 1 1 11.314 0z" />
            </svg>
          </span>
          <span
            class="turn-role__indicator"
            :class="{ 'is-filled': conn.stream }"
            role="img"
            :data-tt="$t('chat.pluginIndicatorStream')"
            :aria-label="$t('chat.pluginIndicatorStream')"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
            </svg>
          </span>
        </div>
      </div>
    </div>

    <ChatReasoningChain
      v-if="
        conn.showReasoningChain &&
        bubbleLoading() &&
        streamingReasoning &&
        !bubbleEditing()
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
        !bubbleLoading() &&
        !bubbleEditing()
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
        'turn-bubble--streaming': bubbleStreaming(),
      }"
    >
      <template v-if="bubbleEditing()">
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
      <template v-else-if="bubbleLoading()">
        <div
          v-if="bubbleStreaming()"
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
      v-if="!bubbleLoading()"
      class="turn-actions turn-actions--assistant"
    >
      <div class="plugin-slots" data-plugin-slot="assistant-turn-footer">
        <PluginSlotMount
          slot-name="assistant-turn-footer"
          :turn="turn"
          :list-index="listIndex"
          :segment-index="segmentIndex"
        />
      </div>
      <div class="turn-toolbar turn-toolbar--assistant">
      <ChatTurnBranchActions
        :turn="turn"
        :disabled="regeneratingTurnOrdinal !== null || isTurnAwaitingAssistant(turn, segIdx)"
      />
      <button
        type="button"
        class="turn-toolbar__btn"
        :disabled="regeneratingTurnOrdinal !== null"
        :data-tt="$t('chat.edit')"
        :aria-label="$t('chat.edit')"
        @click="openEditAssistant(turn, segIdx)"
      >
        <v-icon size="16">mdi-pencil-outline</v-icon>
      </button>
      <button
        type="button"
        class="turn-toolbar__btn"
        :disabled="regeneratingTurnOrdinal !== null || !turn.user.trim()"
        :data-tt="$t('chat.regenerate')"
        :aria-label="$t('chat.regenerate')"
        @click="regenerateAssistant(listIndex, 'regenerate', segIdx)"
      >
        <v-icon size="16">mdi-refresh</v-icon>
      </button>
      <button
        type="button"
        class="turn-toolbar__btn"
        :data-tt="copiedTurnKey === copyKey ? $t('chat.copied') : $t('chat.copy')"
        :class="{ 'is-success': copiedTurnKey === copyKey }"
        :aria-label="$t('chat.copy')"
        @click="copyTurnText(displayAssistantText(turn), copyKey)"
      >
        <v-icon size="16">{{ copiedTurnKey === copyKey ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
      </button>
      <button
        v-if="writeChatPromptSnapshot"
        type="button"
        class="turn-toolbar__btn"
        :disabled="regeneratingTurnOrdinal !== null"
        :data-tt="$t('chat.viewTurnPrompt')"
        :aria-label="$t('chat.viewTurnPrompt')"
        @click="openTurnPromptSnapshot(turn, segIdx)"
      >
        <v-icon size="16">mdi-text-box-search-outline</v-icon>
      </button>
      <button
        type="button"
        class="turn-toolbar__btn turn-toolbar__btn--danger"
        :disabled="regeneratingTurnOrdinal !== null"
        :data-tt="$t('chat.delete')"
        :aria-label="$t('chat.delete')"
        @click="requestDelete(listIndex, segIdx)"
      >
        <v-icon size="16">mdi-delete-outline</v-icon>
      </button>
      <div
        v-if="showAssistantSwipeFooter(turn, listIndex, segIdx)"
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
          @click="slideAssistant(listIndex, 'left', segIdx)"
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
          @click="slideAssistant(listIndex, 'right', segIdx)"
        >
          <v-icon size="16">mdi-chevron-right</v-icon>
        </button>
      </div>
      </div>
    </div>
  </div>
</template>
