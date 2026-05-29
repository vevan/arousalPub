<script setup lang="ts">
import '@/styles/chat-turn.css'
import ChatAssemblePreviewDialog from '@/components/chat/ChatAssemblePreviewDialog.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import ChatDeleteDialog from '@/components/chat/ChatDeleteDialog.vue'
import ChatMessageList from '@/components/chat/ChatMessageList.vue'
import ChatTurnPromptDialog from '@/components/chat/ChatTurnPromptDialog.vue'
import { useChatSession, type ChatSessionProps } from '@/composables/useChatSession'
import { usePreferencesStore } from '@/stores/preferences'
import { storeToRefs } from 'pinia'
import { computed } from 'vue'

const props = withDefaults(defineProps<ChatSessionProps>(), {
  conversationPromptPresetId: null,
  conversationCharacterIds: () => [],
  conversationLorebookIds: () => [],
  conversationUserName: null,
  conversationUserCharacterId: null,
})

const session = useChatSession(props)
const { chatFontSizeRem } = storeToRefs(usePreferencesStore())

const chatSessionStyle = computed(() => ({
  '--chat-font-size': `${chatFontSizeRem.value}rem`,
}))
</script>

<template>
  <div
    class="chat-session"
    :style="chatSessionStyle"
  >
    <ChatMessageList :session="session" />
    <ChatComposer :session="session" />
    <ChatDeleteDialog :session="session" />
    <ChatAssemblePreviewDialog :session="session" />
    <ChatTurnPromptDialog :session="session" />
  </div>
</template>
