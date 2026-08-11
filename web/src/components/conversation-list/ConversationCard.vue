<script setup lang="ts">
import { boundCharacterIds } from '@/utils/chat-list-character-ids'
import { characterImageUrl } from '@/utils/authenticated-media-url'
import { useAuthStore } from '@/stores/auth'
import { conversationRecentChatAt } from '@/composables/conversation-list/use-conversation-list-filters'
import type { ChatListEntry } from '@/composables/conversation-list/types'

defineProps<{
  conversation: ChatListEntry
}>()

const emit = defineEmits<{
  open: [id: string]
  rename: [c: ChatListEntry]
  delete: [c: ChatListEntry]
}>()

const auth = useAuthStore()

const MAX_CARD_CHAR_AVATARS = 4

function characterImage(id: string) {
  return (
    characterImageUrl(auth.user?.id ?? auth.defaultUserId, id, { size: 'm' }) ??
    ''
  )
}

function cardCharacterIds(c: ChatListEntry): string[] {
  return boundCharacterIds(c)
}

function visibleCharacterIds(c: ChatListEntry): string[] {
  return cardCharacterIds(c).slice(0, MAX_CARD_CHAR_AVATARS)
}

function hiddenCharacterCount(c: ChatListEntry): number {
  return Math.max(0, cardCharacterIds(c).length - MAX_CARD_CHAR_AVATARS)
}

function characterAvatarTitle(c: ChatListEntry, charId: string): string {
  const ids = cardCharacterIds(c)
  const idx = ids.indexOf(charId)
  const name = idx >= 0 ? c.characterNames?.[idx]?.trim() : ''
  return name || charId
}

function userCharacterId(c: ChatListEntry): string | null {
  if (typeof c.userCharacterId === 'string' && c.userCharacterId.trim()) {
    return c.userCharacterId.trim()
  }
  return null
}

function formatTime(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}
</script>

<template>
  <article
    class="conv-card"
    tabindex="0"
    @click="emit('open', conversation.conversationId)"
    @keydown.enter="emit('open', conversation.conversationId)"
  >
    <v-menu location="bottom end">
      <template #activator="{ props: menuProps }">
        <v-btn
          class="conv-card__menu"
          icon="mdi-dots-vertical"
          variant="text"
          size="x-small"
          density="comfortable"
          v-bind="menuProps"
          :aria-label="$t('conversationList.cardMenu')"
          @click.stop
        />
      </template>
      <v-list density="compact">
        <v-list-item
          :title="$t('conversationList.rename')"
          prepend-icon="mdi-pencil-outline"
          @click="emit('rename', conversation)"
        />
        <v-list-item
          :title="$t('conversationList.delete')"
          prepend-icon="mdi-delete-outline"
          class="text-error"
          @click="emit('delete', conversation)"
        />
      </v-list>
    </v-menu>

    <div
      v-if="userCharacterId(conversation) || cardCharacterIds(conversation).length"
      class="conv-card__avatars"
      aria-hidden="true"
    >
      <img
        v-if="userCharacterId(conversation)"
        class="conv-card__avatar conv-card__avatar--user"
        :src="characterImage(userCharacterId(conversation)!)"
        alt=""
      />
      <img
        v-for="(charId, i) in visibleCharacterIds(conversation)"
        :key="charId"
        class="conv-card__avatar conv-card__avatar--char"
        :style="{ zIndex: i + 2 }"
        :src="characterImage(charId)"
        :title="characterAvatarTitle(conversation, charId)"
        alt=""
      />
      <span
        v-if="hiddenCharacterCount(conversation) > 0"
        class="conv-card__avatar-more"
        :style="{ zIndex: visibleCharacterIds(conversation).length + 2 }"
      >
        +{{ hiddenCharacterCount(conversation) }}
      </span>
    </div>

    <h2 class="conv-card__title">
      {{ conversation.title || $t('chat.newConversation') }}
    </h2>
    <div class="conv-card__meta">
      <span v-if="typeof conversation.activeTurnCount === 'number'">
        {{ $t('conversationList.turnCount', { n: conversation.activeTurnCount }) }}
      </span>
      <span
        v-if="typeof conversation.activeTurnCount === 'number'"
        class="conv-card__meta-sep"
        aria-hidden="true"
      >
        ·
      </span>
      <span>{{ formatTime(conversationRecentChatAt(conversation)) }}</span>
    </div>
  </article>
</template>

<style scoped>
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

.conv-card::before {
  content: '';
  position: absolute;
  left: 0;
  top: 0.875rem;
  bottom: 0.875rem;
  width: 0.125rem;
  background: rgb(var(--v-theme-secondary));
  opacity: 0.35;
  transition: all 0.2s ease;
  border-radius: 0 0.125rem 0.125rem 0;
}
.conv-card:hover,
.conv-card:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.35);
  background: rgb(var(--v-theme-surface-bright));
  transform: translateY(-0.0625rem);
}
.conv-card:hover::before,
.conv-card:focus-visible::before {
  background: rgb(var(--v-theme-primary));
  opacity: 1;
  top: 0.5rem;
  bottom: 0.5rem;
}

.conv-card__title {
  margin: 0 1.75rem 0.375rem 0;
  font-family: var(--font-display);
  font-size: 1.0625rem;
  font-weight: 500;
  line-height: 1.35;
  letter-spacing: 0.005em;
  color: rgb(var(--v-theme-on-surface));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.conv-card__meta {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  margin-top: auto;
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-transform: uppercase;
}

.conv-card__meta-sep {
  opacity: 0.55;
}

.conv-card__menu {
  position: absolute;
  top: 0.375rem;
  right: 0.375rem;
  z-index: 2;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}

.conv-card__avatars {
  --conv-card-avatar-size: 3rem;
  --conv-card-avatar-overlap: 0.625rem;
  display: flex;
  align-items: center;
  margin-bottom: 0.75rem;
}

.conv-card__avatar {
  width: var(--conv-card-avatar-size);
  height: var(--conv-card-avatar-size);
  border-radius: 50%;
  object-fit: cover;
  border: 0.125rem solid rgb(var(--v-theme-surface-light));
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.conv-card__avatar--char {
  margin-left: calc(-1 * var(--conv-card-avatar-overlap));
}

.conv-card__avatar-more {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: var(--conv-card-avatar-size);
  height: var(--conv-card-avatar-size);
  margin-left: calc(-1 * var(--conv-card-avatar-overlap));
  border-radius: 50%;
  border: 0.125rem solid rgb(var(--v-theme-surface-light));
  background: rgba(var(--v-theme-on-surface), 0.12);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.72);
  flex-shrink: 0;
}

.conv-card__avatar--user {
  z-index: 1;
}
</style>
