<script setup lang="ts">
import '@/styles/chat-turn.css'
import ChatAssemblePreviewDialog from '@/components/chat/ChatAssemblePreviewDialog.vue'
import ChatComposer from '@/components/chat/ChatComposer.vue'
import ChatDeleteDialog from '@/components/chat/ChatDeleteDialog.vue'
import ChatMessageList from '@/components/chat/ChatMessageList.vue'
import ChatTurnPromptDialog from '@/components/chat/ChatTurnPromptDialog.vue'
import PluginFormDialogHost from '@/plugins/PluginFormDialogHost.vue'
import { PLUGIN_HOST_KEY } from '@/plugins/injection'
import { usePluginHost } from '@/plugins/usePluginHost'
import { useChatSession, type ChatSessionProps } from '@/composables/useChatSession'
import { usePreferencesStore } from '@/stores/preferences'
import { storeToRefs } from 'pinia'
import { computed, provide } from 'vue'

const props = withDefaults(defineProps<ChatSessionProps & {
  authorsNoteActive?: boolean
}>(), {
  conversationPromptPresetId: null,
  conversationCharacterIds: () => [],
  conversationCharacterDisplayNames: () => [],
  conversationLorebookIds: () => [],
  conversationUserName: null,
  conversationUserCharacterId: null,
  groupChatEnabled: false,
  authorsNoteActive: false,
})

const emit = defineEmits<{
  (e: 'openAuthorsNote'): void
}>()

const session = useChatSession(props)

const pluginHost = usePluginHost(session, { routeKeys: ['chat'] })
provide(PLUGIN_HOST_KEY, pluginHost)

defineExpose({
  reloadTurns: () => session.loadMessages(),
  /** 供对话页设置对话框（v-dialog teleport）下传 companion，不依赖 inject 树 */
  pluginHost,
  session,
})

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
    <ChatComposer
      :session="session"
      :authors-note-active="authorsNoteActive"
      @open-authors-note="emit('openAuthorsNote')"
    />
    <ChatDeleteDialog :session="session" />
    <ChatAssemblePreviewDialog :session="session" />
    <ChatTurnPromptDialog :session="session" />
    <PluginFormDialogHost />
  </div>
</template>
