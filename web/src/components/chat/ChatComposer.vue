<script setup lang="ts">
import type { useChatSession } from '@/composables/useChatSession'
import { toRefs } from 'vue'

const props = defineProps<{
  session: ReturnType<typeof useChatSession>
}>()

const { userInput, errorText, loading, assemblePreviewLoading } = toRefs(props.session)

const { canSend, canPreviewAssemble } = toRefs(props.session)

const { send, onComposerKeydown, openAssemblePreview } = props.session
</script>

<template>
<!-- Composer · 底部输入栏 -->
  <div class="chat-footer">
    <div class="chat-footer__inner">
      <v-alert
        v-if="errorText"
        type="error"
        variant="tonal"
        class="text-pre-wrap mb-3"
        density="compact"
      >
        {{ errorText }}
      </v-alert>
      <div class="composer">
        <textarea
          v-model="userInput"
          class="composer__textarea"
          rows="3"
          :placeholder="$t('chat.messageLabel')"
          @keydown="onComposerKeydown"
        />
        <div
          class="composer__tools"
          data-plugin-slot="composer-toolbar"
        >
          <span class="composer__hint">
            <kbd>Ctrl</kbd> + <kbd>Enter</kbd> {{ $t('chat.send') }}
          </span>
          <div class="composer__actions">
            <v-btn
              variant="outlined"
              size="small"
              density="comfortable"
              :loading="assemblePreviewLoading"
              :disabled="!canPreviewAssemble"
              class="composer__preview-btn"
              :aria-label="$t('chat.previewAssemble')"
              @click="openAssemblePreview"
            >
              <v-icon size="16" start>mdi-text-search</v-icon>
              {{ $t('chat.previewAssemble') }}
            </v-btn>
            <v-btn
              color="primary"
              variant="flat"
              size="small"
              density="comfortable"
              :loading="loading"
              :disabled="!canSend"
              class="composer__send-btn"
              @click="send"
            >
              <v-icon size="16" start>mdi-send</v-icon>
              {{ $t('chat.send') }}
            </v-btn>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
