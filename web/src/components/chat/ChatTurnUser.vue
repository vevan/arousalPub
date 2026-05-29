<script setup lang="ts">
import type { useChatSession } from '@/composables/useChatSession'
import type { ChatTurnItem } from '@/types/chat-turn'
import { renderRichMessageToHtml } from '@/utils/render-rich-message'
import { toRefs } from 'vue'

const props = defineProps<{
  turn: ChatTurnItem
  listIndex: number
  session: ReturnType<typeof useChatSession>
}>()

const {
  editingTurnOrdinal,
  editingSide,
  editDraft,
  regeneratingTurnOrdinal,
  turnAvatarUrls,
  copiedTurnKey,
} = toRefs(props.session)

const {
  turnLabelN,
  isTurnAwaitingAssistant,
  openEditUser,
  cancelEdit,
  saveEdit,
  copyTurnText,
  requestDeleteWholeTurnFromUser,
} = props.session

const { userDisplayName, userAvatarLetter } = toRefs(props.session)
</script>

<template>
  <div class="turn turn--user">
    <div class="turn-avatar avatar avatar--user" aria-hidden="true">
      <img v-if="turnAvatarUrls.user" :src="turnAvatarUrls.user" alt="" />
      <span v-else>{{ userAvatarLetter }}</span>
    </div>
    <div class="turn-role turn-role--user">
      <span class="turn-role__label">
        {{ userDisplayName }}
        <span class="meta">{{ $t('chat.turnLabel', { n: turnLabelN(turn, listIndex) }) }}</span>
      </span>
      <div class="plugin-slots" data-plugin-slot="user-turn">
        <button
          type="button"
          class="plugin-slot"
          :data-tt="$t('chat.pluginPlaceholderBookmark')"
          :aria-label="$t('chat.pluginPlaceholderBookmark')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
          </svg>
        </button>
        <button
          type="button"
          class="plugin-slot"
          :data-tt="$t('chat.pluginPlaceholderTranslate')"
          :aria-label="$t('chat.pluginPlaceholderTranslate')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" />
            <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
          </svg>
        </button>
        <button
          type="button"
          class="plugin-slot"
          :data-tt="$t('chat.pluginPlaceholderMore')"
          :aria-label="$t('chat.pluginPlaceholderMore')"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>
    </div>

    <template v-if="editingTurnOrdinal === turn.turnOrdinal && editingSide === 'user'">
      <div class="turn-bubble turn-bubble--user turn-bubble--editing">
        <v-textarea
          v-model="editDraft"
          rows="3"
          auto-grow
          max-rows="16"
          variant="outlined"
          density="compact"
          hide-details="auto"
          class="mb-2"
        />
        <div class="d-flex gap-2 justify-end">
          <v-btn size="small" variant="text" @click="cancelEdit">
            {{ $t('settings.themeCancel') }}
          </v-btn>
          <v-btn size="small" color="primary" variant="flat" @click="saveEdit(listIndex)">
            {{ $t('settings.themeConfirm') }}
          </v-btn>
        </div>
      </div>
    </template>
    <div
      v-else
      class="turn-bubble turn-bubble--user"
    >
      <div
        class="chat-rich-text"
        v-html="renderRichMessageToHtml(turn.user)"
      />
    </div>

    <div class="turn-toolbar turn-toolbar--user">
      <button
        type="button"
        class="turn-toolbar__btn"
        :disabled="regeneratingTurnOrdinal !== null || isTurnAwaitingAssistant(turn)"
        :data-tt="$t('chat.edit')"
        :aria-label="$t('chat.edit')"
        @click="openEditUser(turn)"
      >
        <v-icon size="16">mdi-pencil-outline</v-icon>
      </button>
      <button
        type="button"
        class="turn-toolbar__btn"
        :data-tt="copiedTurnKey === `u-${turn.turnOrdinal}` ? $t('chat.copied') : $t('chat.copy')"
        :class="{ 'is-success': copiedTurnKey === `u-${turn.turnOrdinal}` }"
        :aria-label="$t('chat.copy')"
        @click="copyTurnText(turn.user, `u-${turn.turnOrdinal}`)"
      >
        <v-icon size="16">{{ copiedTurnKey === `u-${turn.turnOrdinal}` ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
      </button>
      <button
        type="button"
        class="turn-toolbar__btn turn-toolbar__btn--danger"
        :disabled="regeneratingTurnOrdinal !== null || isTurnAwaitingAssistant(turn)"
        :data-tt="$t('chat.delete')"
        :aria-label="$t('chat.delete')"
        @click="requestDeleteWholeTurnFromUser(listIndex)"
      >
        <v-icon size="16">mdi-delete-outline</v-icon>
      </button>
    </div>
  </div>
</template>
