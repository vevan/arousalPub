<script setup lang="ts">
import HomeChat from '@/components/HomeChat.vue'
import { useConnectionStore } from '@/stores/connection'
import { usePreferencesStore } from '@/stores/preferences'
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const props = defineProps<{
  conversationId: string
}>()

const { t } = useI18n()
const router = useRouter()
const conn = useConnectionStore()
const prefStore = usePreferencesStore()

const loading = ref(true)
const errorText = ref('')
const title = ref('')
const titleSaving = ref(false)

async function ensureConversation(id: string) {
  loading.value = true
  errorText.value = ''
  try {
    let res = await fetch(`/api/chat/conversations/${id}`)
    if (res.status === 404) {
      const created = await fetch('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          conversationId: id,
          title: t('chat.newConversation'),
        }),
      })
      if (!created.ok) {
        errorText.value = t('chatConversation.loadFailed')
        return
      }
      res = await fetch(`/api/chat/conversations/${id}`)
    }
    if (!res.ok) {
      errorText.value = t('chatConversation.loadFailed')
      return
    }
    const idx = (await res.json()) as { title?: string }
    title.value = typeof idx.title === 'string' ? idx.title : t('chat.newConversation')
    void fetch(`/api/chat/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        promptDebug: { maxStored: prefStore.promptDebugMaxStored },
      }),
    })
  } catch {
    errorText.value = t('chatConversation.loadFailed')
  } finally {
    loading.value = false
  }
}

async function saveTitle() {
  const id = props.conversationId
  const next = title.value.trim()
  if (!next) {
    title.value = t('chat.newConversation')
    return
  }
  titleSaving.value = true
  try {
    const res = await fetch(`/api/chat/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: next }),
    })
    if (res.ok) {
      const j = (await res.json()) as { index?: { title?: string } }
      if (j.index?.title) title.value = j.index.title
    }
  } finally {
    titleSaving.value = false
  }
}

watch(
  () => props.conversationId,
  (id) => {
    void ensureConversation(id)
  },
  { immediate: true },
)
</script>

<template>
  <div
    class="chat_pane app-page-shell"
    :class="{ 'chat_pane--state': loading || !!errorText }"
  >
    <div
      v-if="loading"
      class="chat-body chat-body--state pa-4 text-body-2 text-medium-emphasis"
    >
      {{ $t('chatConversation.loading') }}
    </div>
    <div
      v-else-if="errorText"
      class="chat-body chat-body--state pa-4"
    >
      <v-alert type="error" variant="tonal" density="compact">
        {{ errorText }}
      </v-alert>
      <v-btn class="mt-4" variant="text" @click="router.push({ name: 'home' })">
        {{ $t('chatConversation.backHome') }}
      </v-btn>
    </div>
    <template v-else>
      <header class="chat-header">
        <v-btn
          icon="mdi-arrow-left"
          variant="text"
          density="comfortable"
          size="small"
          class="chat-header__back"
          :aria-label="$t('chatConversation.backHome')"
          @click="router.push({ name: 'home' })"
        />
        <div class="chat-header__title-wrap">
          <input
            v-model="title"
            type="text"
            class="chat-header__title-input"
            :placeholder="$t('chat.newConversation')"
            :disabled="titleSaving"
            @blur="saveTitle"
            @keydown.enter.prevent="($event.target as HTMLInputElement)?.blur()"
          />
          <v-progress-circular
            v-if="titleSaving"
            indeterminate
            size="14"
            width="2"
            class="chat-header__saving"
          />
        </div>
        <div class="chat-header__meta">
          <span
            v-if="!conn.apiKey.trim()"
            class="chat-header__pill chat-header__pill--warning"
          >
            <span class="chat-header__dot chat-header__dot--warning" />
            {{ $t('chat.hintConfigureApi') }}
          </span>
          <template v-else>
            <span
              v-if="conn.model.trim()"
              class="chat-header__pill chat-header__pill--accent"
            >
              <span class="chat-header__dot" />
              {{ conn.model.trim() }}
            </span>
            <span
              v-if="conn.alias.trim()"
              class="chat-header__pill"
            >
              {{ conn.alias.trim() }}
            </span>
          </template>
        </div>
      </header>
      <HomeChat :conversation-id="conversationId" />
    </template>
  </div>
</template>

<style scoped>
.chat_pane {
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-columns: minmax(0, 1fr);
  height: calc(100vh - var(--header-height) - var(--footer-height));
  min-height: 0;
  flex: 1 1 auto;
}

.chat_pane--state {
  grid-template-rows: 1fr;
}

.chat-body--state {
  min-height: 0;
  overflow: auto;
}

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

.chat-header__back {
  color: rgba(var(--v-theme-on-surface), 0.7) !important;
}

.chat-header__title-wrap {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
}

.chat-header__title-input {
  flex: 1;
  min-width: 0;
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
  transition: background 0.15s;
}
.chat-header__title-input:hover {
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.chat-header__title-input:focus {
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
}

.chat-header__pill {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.1875rem 0.5625rem;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-light));
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
  white-space: nowrap;
}
.chat-header__pill--accent {
  border-color: rgba(var(--v-theme-primary), 0.35);
  background: rgba(var(--v-theme-primary), 0.06);
  color: rgb(var(--v-theme-primary));
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

.chat-header__dot {
  width: 0.375rem;
  height: 0.375rem;
  border-radius: 50%;
  background: rgb(var(--v-theme-success, 122 143 106));
  box-shadow: 0 0 0 0.1875rem rgb(var(--v-theme-success, 122 143 106) / 0.18);
  flex-shrink: 0;
}
.chat-header__dot--warning {
  background: rgb(var(--v-theme-warning));
  box-shadow: 0 0 0 0.1875rem rgba(var(--v-theme-warning), 0.18);
}
</style>
