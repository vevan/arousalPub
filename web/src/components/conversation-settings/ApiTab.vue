<script setup lang="ts">
import ConversationApiSettingsPanel from '@/components/settings/ConversationApiSettingsPanel.vue'
import type {
  ConversationChatBinding,
  ConversationEmbeddingApiSettingsOverride,
} from '@/utils/conversation-api-settings'
import '@/components/conversation-settings/conversation-settings-fields.css'

defineProps<{
  chatApiUseGlobal: boolean
  embeddingApiUseGlobal: boolean
  chatBinding: ConversationChatBinding | null
  embeddingOverride: ConversationEmbeddingApiSettingsOverride | undefined
  globalEmbeddingModel: string
  globalEmbeddingDimensions: number | null
  allowPropSync: boolean
  savingApiSettings: boolean
}>()

const emit = defineEmits<{
  (e: 'update:chatApiUseGlobal', v: boolean): void
  (e: 'update:embeddingApiUseGlobal', v: boolean): void
  (e: 'saveChat', binding: ConversationChatBinding | null): void
  (e: 'saveEmbedding', patch: ConversationEmbeddingApiSettingsOverride | null): void
}>()

function onChatUseGlobalLocalChange(useGlobal: boolean) {
  emit('update:chatApiUseGlobal', useGlobal)
}
function onEmbeddingUseGlobalLocalChange(useGlobal: boolean) {
  emit('update:embeddingApiUseGlobal', useGlobal)
}
function onSaveChatApi(binding: ConversationChatBinding | null) {
  emit('saveChat', binding)
}
function onSaveEmbeddingApi(patch: ConversationEmbeddingApiSettingsOverride | null) {
  emit('saveEmbedding', patch)
}
</script>

<template>
  <div class="conv-settings-section">
    <ConversationApiSettingsPanel
                    :chat-use-global="chatApiUseGlobal"
                    :chat-binding="chatBinding"
                    :embedding-use-global="embeddingApiUseGlobal"
                    :embedding-override="embeddingOverride"
                    :global-embedding-model="globalEmbeddingModel"
                    :global-embedding-dimensions="globalEmbeddingDimensions"
                    :allow-prop-sync="allowPropSync"
                    :disabled="savingApiSettings"
                    @update:chat-use-global="onChatUseGlobalLocalChange"
                    @update:embedding-use-global="onEmbeddingUseGlobalLocalChange"
                    @save-chat="onSaveChatApi"
                    @save-embedding="onSaveEmbeddingApi"
                  />
  </div>
</template>
