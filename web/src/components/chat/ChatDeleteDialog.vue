<script setup lang="ts">
import type { useChatSession } from '@/composables/useChatSession'
import { toRefs } from 'vue'

const props = defineProps<{
  session: ReturnType<typeof useChatSession>
}>()

const { deleteDialogOpen } = toRefs(props.session)

const { deleteDialogMessage } = toRefs(props.session)

const { cancelDelete, confirmDelete } = props.session
</script>

<template>
<v-dialog
    v-model="deleteDialogOpen"
  >
    <v-card>
      <v-card-title class="text-subtitle-1">
        {{ $t('chat.delete') }}
      </v-card-title>
      <v-card-text class="text-body-2">
        {{ deleteDialogMessage }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn
          variant="text"
          @click="cancelDelete"
        >
          {{ $t('settings.themeCancel') }}
        </v-btn>
        <v-btn
          color="error"
          variant="flat"
          @click="confirmDelete"
        >
          {{ $t('chat.delete') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
