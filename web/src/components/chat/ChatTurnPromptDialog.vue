<script setup lang="ts">
import type { useChatSession } from '@/composables/useChatSession'
import { toRefs } from 'vue'

const props = defineProps<{
  session: ReturnType<typeof useChatSession>
}>()

const {
  turnPromptDialogOpen,
  turnPromptLoading,
  turnPromptError,
  turnPromptDisplay,
  turnPromptIsEmpty,
  turnPromptCopied,
  turnPromptRawCopied,
} = toRefs(props.session)

const { copyTurnPromptDisplay, copyTurnPromptRaw } = props.session
</script>

<template>
<v-dialog
    v-model="turnPromptDialogOpen"
    scrollable
  >
    <v-card>
      <v-card-title class="text-h6">
        {{ $t('chat.turnPromptDialogTitle') }}
      </v-card-title>
      <v-divider />
      <v-card-text class="pa-4" style="max-height: min(70vh, 32rem)">
        <v-progress-linear
          v-if="turnPromptLoading"
          indeterminate
          class="mb-2 rounded"
          color="primary"
        />
        <v-alert
          v-if="turnPromptError"
          type="error"
          variant="tonal"
          density="compact"
          class="mb-0"
        >
          {{ turnPromptError }}
        </v-alert>
        <template v-else-if="!turnPromptLoading">
          <p
            v-if="turnPromptIsEmpty"
            class="text-body-2 text-medium-emphasis mb-0"
          >
            {{ $t('chat.turnPromptEmpty') }}
          </p>
          <pre
            v-else
            class="prompt-json text-body-2 mb-0"
          >{{ turnPromptDisplay }}</pre>
        </template>
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-3">
        <v-spacer />
        <template v-if="turnPromptDisplay && !turnPromptLoading && !turnPromptError">
          <v-btn
            variant="text"
            :class="{ 'text-primary': turnPromptCopied }"
            @click="copyTurnPromptDisplay"
          >
            {{
              turnPromptCopied
                ? $t('chat.turnPromptCopied')
                : $t('chat.turnPromptCopy')
            }}
          </v-btn>
          <v-btn
            variant="text"
            :class="{ 'text-primary': turnPromptRawCopied }"
            @click="copyTurnPromptRaw"
          >
            {{
              turnPromptRawCopied
                ? $t('chat.turnPromptCopied')
                : $t('chat.turnPromptCopyRaw')
            }}
          </v-btn>
        </template>
        <v-btn
          variant="text"
          @click="turnPromptDialogOpen = false"
        >
          {{ $t('chat.turnPromptClose') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
