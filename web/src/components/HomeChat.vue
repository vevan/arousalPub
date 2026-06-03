<script setup lang="ts">
import '@/styles/chat-turn.css'
import ChatAssemblePreviewDialog from '@/components/chat/ChatAssemblePreviewDialog.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import ChatDeleteDialog from '@/components/chat/ChatDeleteDialog.vue'
import ChatMessageList from '@/components/chat/ChatMessageList.vue'
import ChatTurnPromptDialog from '@/components/chat/ChatTurnPromptDialog.vue'
import PluginFormDialogHost from '@/plugins/PluginFormDialogHost.vue'
import PluginUiHost from '@/plugins/PluginUiHost.vue'
import { PLUGIN_HOST_KEY } from '@/plugins/injection'
import { usePluginHost } from '@/plugins/usePluginHost'
import { useChatSession, type ChatSessionProps } from '@/composables/useChatSession'
import { usePreferencesStore } from '@/stores/preferences'
import { storeToRefs } from 'pinia'
import { computed, provide } from 'vue'

const props = withDefaults(defineProps<ChatSessionProps>(), {
  conversationPromptPresetId: null,
  conversationCharacterIds: () => [],
  conversationLorebookIds: () => [],
  conversationUserName: null,
  conversationUserCharacterId: null,
})

const session = useChatSession(props)
const pluginHost = usePluginHost(session)
provide(PLUGIN_HOST_KEY, pluginHost)

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
    <PluginFormDialogHost />
    <PluginUiHost />
  </div>
</template>
