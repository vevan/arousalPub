<script setup lang="ts">
import type { useChatSession } from '@/composables/useChatSession'
import { renderReasoningMarkdownToHtml } from '@/utils/render-rich-message'
import { reasoningCharsCount } from '@/utils/chat-turn-display'
import { computed, toRefs } from 'vue'

const props = defineProps<{
  turnOrdinal: number
  reasoningText: string
  copyKey: string
  session: ReturnType<typeof useChatSession>
}>()

const { copiedTurnKey } = toRefs(props.session)
const { copyTurnText, isReasoningChainOpen, toggleReasoningChain } = props.session

const open = computed(() => isReasoningChainOpen(props.turnOrdinal))

function onSummaryClick() {
  toggleReasoningChain(props.turnOrdinal)
}
</script>

<template>
  <div
    class="reasoning-chain"
    :class="{ 'is-open': open }"
    :data-turn-ordinal="turnOrdinal"
  >
    <div class="reasoning-chain__head">
      <div
        class="reasoning-chain__summary"
        role="button"
        tabindex="0"
        @click="onSummaryClick"
        @keydown.enter.prevent="onSummaryClick"
        @keydown.space.prevent="onSummaryClick"
      >
        <span class="reasoning-chain__caret">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <polyline
              points="9 6 15 12 9 18"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            />
          </svg>
        </span>
        <span class="reasoning-chain__title">
          {{ $t('chat.reasoningSummary') }}
          <span class="reasoning-chain__meta">
            {{ $t('chat.reasoningCharsMeta', { n: reasoningCharsCount(reasoningText) }) }}
          </span>
        </span>
        <span class="reasoning-chain__hint">
          <span class="reasoning-chain__hint-expand">{{ $t('chat.expand') }}</span>
          <span class="reasoning-chain__hint-collapse">{{ $t('chat.collapse') }}</span>
          <kbd>{{ $t('chat.shortcutKey') }}</kbd>
        </span>
      </div>
      <button
        type="button"
        class="turn-toolbar__btn reasoning-chain__copy"
        :data-tt="copiedTurnKey === copyKey ? $t('chat.copied') : $t('chat.copy')"
        :class="{ 'is-success': copiedTurnKey === copyKey }"
        :aria-label="$t('chat.copy')"
        @click="copyTurnText(reasoningText, copyKey)"
      >
        <v-icon size="14">
          {{ copiedTurnKey === copyKey ? 'mdi-check' : 'mdi-content-copy' }}
        </v-icon>
      </button>
    </div>
    <div
      v-show="open"
      class="reasoning-chain__body chat-rich-text"
      v-html="renderReasoningMarkdownToHtml(reasoningText)"
    />
  </div>
</template>
