<script setup lang="ts">
import type { useChatSession } from '@/composables/useChatSession'
import ChatComposerInputHistoryMenu from '@/components/chat/ChatComposerInputHistoryMenu.vue'
import ChatComposerSlashMenu from '@/components/chat/ChatComposerSlashMenu.vue'
import PluginSlotMount from '@/plugins/PluginSlotMount.vue'
import { useComposerSlashMenu } from '@/composables/chat-session/use-composer-slash-menu'
import { usePreferencesStore } from '@/stores/preferences'
import { storeToRefs } from 'pinia'
import { computed, ref, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  session: ReturnType<typeof useChatSession>
  authorsNoteActive?: boolean
}>()

const emit = defineEmits<{
  (e: 'openAuthorsNote'): void
}>()

const { composerEnterMode } = storeToRefs(usePreferencesStore())
const { t } = useI18n()

const authorsNoteTooltip = computed(() =>
  props.authorsNoteActive
    ? t('chat.authorsNoteTooltipOn')
    : t('chat.authorsNoteTooltipOff'),
)

const messagePlaceholder = computed(() =>
  composerEnterMode.value === 'enter-send'
    ? t('chat.composerPlaceholderEnterSend')
    : t('chat.composerPlaceholderCtrlEnterSend'),
)

const { userInput, errorText, assemblePreviewLoading, writeChatPromptSnapshot } =
  toRefs(props.session)

const { canSend, canPreviewAssemble, isGenerating } = toRefs(props.session)

const { send, abortCurrentReply, openAssemblePreview } = props.session

const textareaRef = ref<HTMLTextAreaElement | null>(null)

const slashMenu = useComposerSlashMenu({
  userInput,
  textareaRef,
})

const { isOpen, filtered, activeIndex } = slashMenu

const composerAnchorClass = computed(() =>
  isOpen.value ? 'composer--slash-anchor' : '',
)

const sendHovered = ref(false)

const sendBtnLoading = computed(() => isGenerating.value && !sendHovered.value)

const sendBtnIcon = computed(() => {
  if (isGenerating.value && sendHovered.value) return 'mdi-stop'
  return 'mdi-send'
})

const sendBtnAriaLabel = computed(() =>
  isGenerating.value ? t('chat.abortGeneration') : t('chat.send'),
)

const sendBtnAbortHover = computed(() => isGenerating.value && sendHovered.value)

function syncSlashMenu() {
  slashMenu.syncMenuFromInput()
}

function onComposerInput() {
  syncSlashMenu()
}

function onComposerClick() {
  syncSlashMenu()
}

function onComposerKeydown(e: KeyboardEvent) {
  if (slashMenu.handleSlashKeydown(e)) return
  props.session.onComposerKeydown(e)
}

watch(filtered, () => {
  slashMenu.clampActiveIndex()
})

function onSendClick() {
  if (isGenerating.value) {
    abortCurrentReply()
    return
  }
  void send()
}

function onSlashHover(index: number) {
  activeIndex.value = index
}
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
      <div
        class="composer"
        :class="composerAnchorClass"
      >
        <ChatComposerSlashMenu
          :open="isOpen"
          :items="filtered"
          :active-index="activeIndex"
          @pick="slashMenu.applySpec"
          @hover="onSlashHover"
        />
        <div class="composer__field">
          <textarea
            ref="textareaRef"
            v-model="userInput"
            class="composer__textarea"
            rows="3"
            :placeholder="messagePlaceholder"
            @input="onComposerInput"
            @click="onComposerClick"
            @keyup="syncSlashMenu"
            @keydown="onComposerKeydown"
          />
          <v-btn
            icon
            color="primary"
            variant="flat"
            :loading="sendBtnLoading"
            :disabled="!canSend && !isGenerating"
            class="composer__send-btn"
            :class="{ 'composer__send-btn--abort': sendBtnAbortHover }"
            :aria-label="sendBtnAriaLabel"
            @mouseenter="sendHovered = true"
            @mouseleave="sendHovered = false"
            @click="onSendClick"
          >
            <v-icon
              v-if="!sendBtnLoading"
              size="22"
            >
              {{ sendBtnIcon }}
            </v-icon>
          </v-btn>
        </div>
        <div
          class="composer__tools"
          data-plugin-slot="composer-toolbar"
        >
          <div class="composer__actions">
            <v-tooltip
              location="top"
              :text="authorsNoteTooltip"
            >
              <template #activator="{ props: tooltipProps }">
                <v-btn
                  icon
                  variant="text"
                  size="small"
                  density="comfortable"
                  class="composer__authors-note-btn"
                  :class="{ 'composer__authors-note-btn--active': authorsNoteActive }"
                  v-bind="tooltipProps"
                  :aria-label="authorsNoteTooltip"
                  @click="emit('openAuthorsNote')"
                >
                  <v-icon size="20">mdi-note-text-outline</v-icon>
                </v-btn>
              </template>
            </v-tooltip>
            <ChatComposerInputHistoryMenu :session="props.session" />
            <div class="plugin-slots composer__plugin-slots">
              <PluginSlotMount slot-name="composer-toolbar" />
            </div>
            <v-btn
              v-if="writeChatPromptSnapshot"
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

<style scoped>
.composer--slash-anchor {
  anchor-name: --composer-slash-anchor;
}
</style>
