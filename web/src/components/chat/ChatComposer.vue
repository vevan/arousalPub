<script setup lang="ts">
import type { useChatSession } from '@/composables/useChatSession'
import PluginSlotMount from '@/plugins/PluginSlotMount.vue'
import { usePreferencesStore } from '@/stores/preferences'
import { storeToRefs } from 'pinia'
import { toRefs } from 'vue'

const props = defineProps<{
  session: ReturnType<typeof useChatSession>
}>()

const { composerEnterMode } = storeToRefs(usePreferencesStore())

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
        <div class="composer__field">
          <textarea
            v-model="userInput"
            class="composer__textarea"
            rows="3"
            :placeholder="$t('chat.messageLabel')"
            @keydown="onComposerKeydown"
          />
          <v-btn
            icon
            color="primary"
            variant="flat"
            :loading="loading"
            :disabled="!canSend"
            class="composer__send-btn"
            :aria-label="$t('chat.send')"
            @click="send"
          >
            <v-icon size="22">mdi-send</v-icon>
          </v-btn>
        </div>
        <div
          class="composer__tools"
          data-plugin-slot="composer-toolbar"
        >
          <span class="composer__hint">
            <template v-if="composerEnterMode === 'enter-send'">
              <kbd>Enter</kbd> {{ $t('chat.send') }}
              <span class="composer__hint-sep">·</span>
              <kbd>Ctrl</kbd>+<kbd>Enter</kbd> {{ $t('chat.newline') }}
            </template>
            <template v-else>
              <kbd>Ctrl</kbd>+<kbd>Enter</kbd> {{ $t('chat.send') }}
              <span class="composer__hint-sep">·</span>
              <kbd>Enter</kbd> {{ $t('chat.newline') }}
            </template>
          </span>
          <div class="composer__actions">
            <div class="plugin-slots composer__plugin-slots">
              <PluginSlotMount slot-name="composer-toolbar" />
            </div>
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
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
