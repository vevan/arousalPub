<script setup lang="ts">
export interface AssembledMessageItem {
  role: string
  content: string
}

defineProps<{
  messages: AssembledMessageItem[]
  emptyText?: string
}>()

function roleChipColor(role: string): string {
  if (role === 'system') return 'primary'
  if (role === 'user') return 'secondary'
  return 'success'
}

function roleBlockClass(role: string): string {
  if (role === 'system') return 'audit-msg--system'
  if (role === 'user') return 'audit-msg--user'
  return 'audit-msg--assistant'
}
</script>

<template>
  <p
    v-if="messages.length === 0"
    class="assembled-messages-panel__empty text-body-2 text-medium-emphasis mb-0"
  >
    {{ emptyText ?? '' }}
  </p>
  <div
    v-else
    class="assembled-messages-panel"
  >
    <div
      v-for="(msg, idx) in messages"
      :key="idx"
      class="audit-msg"
      :class="roleBlockClass(msg.role)"
    >
      <div class="audit-msg__head">
        <span class="audit-msg__index">#{{ idx + 1 }}</span>
        <v-chip
          size="x-small"
          :color="roleChipColor(msg.role)"
          variant="tonal"
          label
        >
          {{ msg.role }}
        </v-chip>
      </div>
      <pre class="audit-msg__body">{{ msg.content }}</pre>
    </div>
  </div>
</template>
