<script setup lang="ts">
import ChatTurnBlock from '@/components/chat/ChatTurnBlock.vue'
import type { useChatSession } from '@/composables/useChatSession'
import { toRefs } from 'vue'

const props = defineProps<{
  session: ReturnType<typeof useChatSession>
}>()

const { chatScrollEl, turns, errorText } = toRefs(props.session)
</script>

<template>
  <div
    ref="chatScrollEl"
    class="chat-body chat-scroll"
  >
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
