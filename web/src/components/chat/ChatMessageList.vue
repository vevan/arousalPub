<script setup lang="ts">
import ChatTurnBlock from '@/components/chat/ChatTurnBlock.vue'
import type { useChatSession } from '@/composables/useChatSession'
import { toRefs } from 'vue'

const props = defineProps<{
  session: ReturnType<typeof useChatSession>
}>()

const {
  chatScrollEl,
  turns,
  errorText,
  hasMoreBefore,
  loadingOlder,
  loadOlderMessages,
} = toRefs(props.session)
</script>

<template>
  <div
    ref="chatScrollEl"
    class="chat-body chat-scroll"
  >
    <div
      v-if="hasMoreBefore || loadingOlder"
      class="chat-load-older"
    >
      <v-progress-circular
        v-if="loadingOlder"
        indeterminate
        size="20"
        width="2"
        color="primary"
      />
      <button
        v-else
        type="button"
        class="chat-load-older__btn"
        @click="loadOlderMessages()"
      >
        {{ $t('chat.loadOlderTurns') }}
      </button>
    </div>

    <ChatTurnBlock
      v-for="(turn, i) in turns"
      :key="`${turn.turnOrdinal}-${i}`"
      :turn="turn"
      :list-index="i"
      :session="session"
    />

    <div
      v-if="!turns.length && !errorText"
      class="chat-empty"
    >
      <div class="chat-empty__ornament">❦</div>
      <div class="chat-empty__text">
        {{ $t('chat.emptyHint') }}
      </div>
    </div>
  </div>
</template>
