<script setup lang="ts">
import ConversationCard from '@/components/conversation-list/ConversationCard.vue'
import type { ChatListEntry } from '@/composables/conversation-list/types'

defineProps<{
  conversations: ChatListEntry[]
  creating: boolean
}>()

const emit = defineEmits<{
  create: []
  open: [id: string]
  rename: [c: ChatListEntry]
  delete: [c: ChatListEntry]
}>()
</script>

<template>
  <div class="conv-grid">
    <button
      type="button"
      class="conv-card conv-card--new"
      :class="{ 'is-loading': creating }"
      :disabled="creating"
      :aria-label="$t('conversationList.newChat')"
      @click="emit('create')"
    >
      <v-progress-circular
        v-if="creating"
        indeterminate
        color="primary"
        size="36"
      />
      <template v-else>
        <span class="conv-card--new__plus">+</span>
        <span class="conv-card--new__label">{{
          $t('conversationList.newChat')
        }}</span>
      </template>
    </button>

    <ConversationCard
      v-for="c in conversations"
      :key="c.conversationId"
      :conversation="c"
      @open="emit('open', $event)"
      @rename="emit('rename', $event)"
      @delete="emit('delete', $event)"
    />
  </div>
</template>

<style scoped>
.conv-grid {
  flex: 0 0 auto;
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.75rem;
}

.conv-card {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 6.5rem;
  padding: 1rem 1rem 0.875rem 1.25rem;
  background: rgb(var(--v-theme-surface-light));
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 0.5rem;
  cursor: pointer;
  transition: all 0.18s ease;
  text-align: start;
  font: inherit;
  color: inherit;
  outline: none;
  overflow: hidden;
}

.conv-card--new {
  align-items: center;
  justify-content: center;
  padding: 1.75rem 1rem;
  background: transparent;
  border: 0.0625rem dashed rgba(var(--v-theme-primary), 0.35);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.conv-card--new::before {
  display: none;
}
.conv-card--new:not(:disabled):hover {
  background: rgba(var(--v-theme-primary), 0.04);
  border-color: rgb(var(--v-theme-primary));
  border-style: dashed;
  color: rgb(var(--v-theme-on-surface));
}
.conv-card--new__plus {
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 400;
  color: rgb(var(--v-theme-primary));
  line-height: 1;
  margin-bottom: 0.375rem;
}
.conv-card--new__label {
  font-family: var(--font-display);
  font-size: 0.9375rem;
  font-style: italic;
  letter-spacing: 0.01em;
}
.conv-card--new:disabled {
  cursor: progress;
  opacity: 0.5;
}
</style>
