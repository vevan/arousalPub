<script setup lang="ts">
import ConversationRegexApplyPanel from '@/components/settings/ConversationRegexApplyPanel.vue'
import { ref } from 'vue'
import '@/components/conversation-settings/conversation-settings-fields.css'

defineProps<{
  conversationId: string
}>()

const emit = defineEmits<{
  (e: 'applied'): void
}>()

const regexApplyPanelRef = ref<InstanceType<typeof ConversationRegexApplyPanel> | null>(null)

defineExpose({
  reload: () => regexApplyPanelRef.value?.reload(),
})
</script>

<template>
  <div class="conv-settings-section">
    <ConversationRegexApplyPanel
                    ref="regexApplyPanelRef"
                    :conversation-id="conversationId"
                    @applied="emit('applied')"
                  />
  </div>
</template>
