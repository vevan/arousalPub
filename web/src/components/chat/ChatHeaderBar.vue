<script setup lang="ts">
defineProps<{
  title: string
  titleSaving: boolean
  showGroupRoster: boolean
  branchBusy: boolean
  activeBranchDisplayLabel: string
  apiKeyConfigured: boolean
  headerChatLabel: string
  boundPromptLabel: string
  boundLorebooks: { id: string; label: string }[]
  canOpenGroupChatSettings: boolean
  groupChatEnabled: boolean
  hasBgm: boolean
  bgmMuted: boolean
}>()

const emit = defineEmits<{
  'update:title': [value: string]
  'save-title': []
  back: []
  'open-branch-panel': []
  'open-bound-prompt': []
  'open-bound-lorebook': [lorebookId: string]
  'open-group-chat': []
  'toggle-bgm': []
  'open-settings': []
}>()

function onTitleInput(event: Event) {
  emit('update:title', (event.target as HTMLInputElement).value)
}

function onTitleEnter(event: Event) {
  ;(event.target as HTMLInputElement)?.blur()
}
</script>

<template>
  <header
    class="chat-header"
    :class="{ 'chat-header--roster-anchor': showGroupRoster }"
  >
    <v-btn
      icon="mdi-arrow-left"
      variant="text"
      density="comfortable"
      size="small"
      class="chat-header__back"
      :aria-label="$t('chatConversation.backHome')"
      @click="emit('back')"
    />
    <div class="chat-header__title-wrap">
      <input
        :value="title"
        type="text"
        class="chat-header__title-input"
        :placeholder="$t('chat.newConversation')"
        :disabled="titleSaving"
        @input="onTitleInput"
        @blur="emit('save-title')"
        @keydown.enter.prevent="onTitleEnter"
      />
      <v-progress-circular
        v-if="titleSaving"
        indeterminate
        size="14"
        width="2"
        class="chat-header__saving"
      />
      <button
        type="button"
        class="chat-header__pill chat-header__pill--clickable chat-header__pill--branch"
        :title="$t('chat.branches.openPanel')"
        :aria-label="$t('chat.branches.openPanel')"
        :disabled="branchBusy"
        @click="emit('open-branch-panel')"
      >
        <v-icon
          icon="mdi-source-branch"
          size="14"
          class="chat-header__pill-icon"
        />
        <span class="chat-header__pill-label">
          {{ activeBranchDisplayLabel }}
        </span>
      </button>
    </div>
    <div class="chat-header__meta">
      <span
        v-if="!apiKeyConfigured"
        class="chat-header__pill chat-header__pill--warning"
      >
        <span class="chat-header__dot chat-header__dot--warning" />
        {{ $t('chat.hintConfigureApi') }}
      </span>
      <template v-else>
        <span
          v-if="headerChatLabel"
          class="chat-header__pill"
        >
          {{ headerChatLabel }}
        </span>
        <button
          v-if="boundPromptLabel"
          type="button"
          class="chat-header__pill chat-header__pill--prompt chat-header__pill--clickable"
          :title="boundPromptLabel"
          :aria-label="boundPromptLabel"
          @click="emit('open-bound-prompt')"
        >
          <v-icon
            icon="mdi-text-box-outline"
            size="14"
            class="chat-header__pill-icon"
          />
          <span class="chat-header__pill-label">{{ boundPromptLabel }}</span>
        </button>
        <v-menu
          v-if="boundLorebooks.length > 0"
          location="bottom end"
          :open-on-hover="true"
          :close-on-content-click="true"
        >
          <template #activator="{ props: menuProps }">
            <v-btn
              v-bind="menuProps"
              icon
              variant="text"
              density="comfortable"
              size="small"
              class="chat-header__lorebook-btn"
              :aria-label="$t('chatConversation.boundLorebook')"
            >
              <v-badge
                class="chat-header__lorebook-badge"
                :content="boundLorebooks.length"
                color="primary"
                floating
              >
                <v-icon
                  icon="mdi-book-open-page-variant-outline"
                  size="20"
                />
              </v-badge>
            </v-btn>
          </template>
          <v-list
            density="compact"
            class="chat-header__lorebook-menu"
          >
            <v-list-item
              v-for="lb in boundLorebooks"
              :key="lb.id"
              :title="lb.label"
              :aria-label="lb.label"
              @click="emit('open-bound-lorebook', lb.id)"
            />
          </v-list>
        </v-menu>
      </template>
      <v-btn
        v-if="canOpenGroupChatSettings"
        icon
        variant="text"
        density="comfortable"
        size="small"
        class="chat-header__group-chat"
        :color="groupChatEnabled ? 'primary' : undefined"
        :aria-label="$t('chat.groupChat.settings.openButton')"
        @click="emit('open-group-chat')"
      >
        <v-icon icon="mdi-account-group-outline" size="20" />
      </v-btn>
      <v-btn
        v-if="hasBgm"
        icon
        variant="text"
        density="comfortable"
        size="small"
        class="chat-header__bgm"
        :aria-label="
          bgmMuted
            ? $t('chatConversation.bgmUnmute')
            : $t('chatConversation.bgmMute')
        "
        @click="emit('toggle-bgm')"
      >
        <v-icon
          :icon="bgmMuted ? 'mdi-volume-off' : 'mdi-music-note'"
          size="20"
        />
      </v-btn>
      <v-btn
        icon="mdi-cog-outline"
        variant="text"
        density="comfortable"
        size="small"
        class="chat-header__settings"
        :aria-label="$t('chat.convSettings.openButton')"
        @click="emit('open-settings')"
      />
    </div>
  </header>
</template>

<style scoped>
/* ========== Chat Header · Tavern × Linear ========== */
.chat-header {
  display: grid;
  grid-template-columns: auto 1fr auto;
  align-items: center;
  gap: 0.75rem;
  padding: 0.875rem 0.25rem 0.75rem;
  border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.06);
  min-width: 0;
}

.chat-header--roster-anchor {
  anchor-name: --chat-header-roster-anchor;
}

.chat-header__back {
  color: rgba(var(--v-theme-on-surface), 0.7) !important;
}

.chat-header__title-wrap {
  display: grid;
  grid-auto-flow: column;
  grid-auto-columns: max-content;
  align-items: center;
  justify-content: start;
  gap: 0.5rem;
  min-width: 0;
}

.chat-header__title-input {
  width: 8em;
  max-width: 8em;
  min-width: 0;
  box-sizing: border-box;
  background: transparent;
  border: none;
  font-family: var(--font-display);
  font-size: 1.1875rem;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
  letter-spacing: 0.005em;
  padding: 0.25rem 0.375rem;
  border-radius: 0.25rem;
  outline: none;
  transition:
    background 0.15s,
    max-width 0.2s ease;
}
@supports (field-sizing: content) {
  .chat-header__title-input {
    field-sizing: content;
    width: auto;
    min-width: 2.5em;
  }
}
.chat-header__title-input:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.chat-header__title-input:focus {
  max-width: 18em;
  background: rgba(var(--v-theme-on-surface), 0.04);
  box-shadow: inset 0 -0.0625rem 0 rgba(var(--v-theme-primary), 0.6);
}
.chat-header__title-input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.35);
  font-style: italic;
}
.chat-header__title-input:disabled {
  opacity: 0.5;
}

.chat-header__saving {
  color: rgb(var(--v-theme-primary)) !important;
}

.chat-header__meta {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  flex-shrink: 0;
  min-width: 0;
}

.chat-header__settings {
  flex-shrink: 0;
  margin-left: 0.125rem;
}

.chat-header__lorebook-btn {
  color: rgba(var(--v-theme-on-surface), 0.75) !important;
}

.chat-header__lorebook-btn :deep(.chat-header__lorebook-badge .v-badge__badge) {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 2em;
  height: 2.5em;
  padding: 1em;
  line-height: 1;
  transform: scale(0.3);
  transform-origin: bottom left;
  border-radius: 1em;
}

.chat-header__pill-icon {
  flex-shrink: 0;
}

.chat-header__pill-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header__pill--prompt {
  max-width: 15em;
  min-width: 0;
}

.chat-header__pill--branch {
  width: max-content;
  max-width: 8em;
  min-width: 0;
}

:deep(.chat-header__lorebook-menu .v-list-item-title) {
  max-width: 15em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-header__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.1875rem 0.5625rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: var(--radius-sm);
  background: rgb(var(--v-theme-surface-light));
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.chat-header__pill--warning {
  border-color: rgba(var(--v-theme-warning), 0.5);
  background: rgba(var(--v-theme-warning), 0.08);
  color: rgb(var(--v-theme-warning));
  font-family: var(--font-ui);
  font-size: 0.71875rem;
  letter-spacing: 0;
  text-transform: none;
}

.chat-header__pill--clickable {
  cursor: pointer;
  font: inherit;
  appearance: none;
  transition:
    border-color 0.15s ease,
    background-color 0.15s ease;
}
.chat-header__pill--clickable:hover {
  border-color: rgba(var(--v-theme-primary), 0.35);
  background: rgba(var(--v-theme-primary), 0.06);
}

.chat-header__dot--warning {
  background: rgb(var(--v-theme-warning));
  box-shadow: 0 0 0 0.1875rem rgba(var(--v-theme-warning), 0.18);
}

@media (max-width: 40rem) {
  .chat-header {
    gap: 0.5rem;
    padding-inline: 0;
  }

  .chat-header__pill--branch .chat-header__pill-label,
  .chat-header__pill--prompt .chat-header__pill-label {
    display: none;
  }

  .chat-header__pill--branch,
  .chat-header__pill--prompt {
    width: auto;
    max-width: none;
    padding: 0.3125rem;
    justify-content: center;
  }

  .chat-header__pill--branch :deep(.v-icon),
  .chat-header__pill--prompt :deep(.v-icon) {
    font-size: 1.125rem;
  }
}
</style>
