<script setup lang="ts">
import ConversationPluginSettingsPanel from '@/components/settings/ConversationPluginSettingsPanel.vue'
import { ref } from 'vue'
import '@/components/conversation-settings/conversation-settings-fields.css'

defineProps<{
  conversationId: string
  pluginHost?: import('@/plugins/injection').PluginHostContext | null
}>()

const emit = defineEmits<{
  (e: 'savingChange', v: boolean): void
  (e: 'error', message: string): void
}>()

const pluginSettingsPanelRef = ref<InstanceType<
  typeof ConversationPluginSettingsPanel
> | null>(null)

defineExpose({
  reload: () => pluginSettingsPanelRef.value?.reload(),
  backToList: () => pluginSettingsPanelRef.value?.backToList(),
})
</script>

<template>
  <div class="conv-settings-section">
    <ConversationPluginSettingsPanel
                    ref="pluginSettingsPanelRef"
                    :conversation-id="conversationId"
                    :plugin-host="pluginHost"
                    @saving-change="emit('savingChange', $event)"
                    @error="emit('error', $event)"
                  />
  </div>
</template>
