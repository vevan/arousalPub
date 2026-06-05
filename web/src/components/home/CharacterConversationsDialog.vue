<script setup lang="ts">
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { conversationUsesCharacter } from '@/utils/chat-list-character-ids'
import { markHomeReturnFromChat } from '@/utils/home-navigation'

export interface ChatListEntryLite {
  conversationId: string
  title: string
  updatedAt: string
  userCharacterId?: string
  characterId?: string | null
  characterIds?: string[]
}

const props = defineProps<{
  modelValue: boolean
  characterId: string | null
  characterName: string
  conversations: ChatListEntryLite[]
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
}>()

const router = useRouter()

const linked = computed(() => {
  const id = props.characterId?.trim()
  if (!id) return []
  return props.conversations.filter((c) => conversationUsesCharacter(c, id))
})

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function close() {
  emit('update:modelValue', false)
}

function openChat(conversationId: string) {
  close()
  markHomeReturnFromChat()
  void router.push({ name: 'chat', params: { conversationId } })
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="28rem"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="text-h6">
        {{
          $t('characterConversations.dialogTitle', {
            name: characterName || '—',
          })
        }}
      </v-card-title>
      <v-card-text class="pa-0">
        <p
          v-if="linked.length === 0"
          class="text-body-2 text-medium-emphasis pa-4 mb-0"
        >
          {{ $t('characterConversations.empty') }}
        </p>
        <v-list v-else density="compact" class="py-0">
          <v-list-item
            v-for="c in linked"
            :key="c.conversationId"
            :title="c.title || $t('chat.newConversation')"
            :subtitle="formatTime(c.updatedAt)"
            append-icon="mdi-chevron-right"
            @click="openChat(c.conversationId)"
          />
        </v-list>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="close">
          {{ $t('app.closeModal') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
