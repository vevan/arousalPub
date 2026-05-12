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
    class="chat_pane"
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
        <div class="chat-header__row">
          <v-btn
            icon="mdi-arrow-left"
            variant="text"
            density="comfortable"
            :aria-label="$t('chatConversation.backHome')"
            @click="router.push({ name: 'home' })"
          />
          <v-text-field
            v-model="title"
            :label="$t('chatConversation.titleLabel')"
            variant="underlined"
            density="comfortable"
            hide-details="auto"
            class="chat-header__title flex-grow-1"
            :loading="titleSaving"
            @blur="saveTitle"
            @keydown.enter.prevent="($event.target as HTMLInputElement)?.blur()"
          />
        </div>
        <div class="chat-header__config">
          <p
            v-if="!conn.apiKey.trim()"
            class="text-caption text-warning mb-0"
          >
            {{ $t('chat.hintConfigureApi') }}
          </p>
          <template v-else>
            <p
              v-if="conn.alias.trim()"
              class="text-caption text-medium-emphasis mb-0"
            >
              {{ $t('chat.currentPreset') }}{{ conn.alias.trim() }}
            </p>
            <p
              v-if="conn.model.trim()"
              class="text-caption text-medium-emphasis mb-0"
            >
              {{ $t('chat.currentModel') }}{{ conn.model.trim() }}
            </p>
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
  max-width: 52rem;
  margin-inline: auto;
  width: 100%;
  min-width: 0;
  min-height: 0;
  padding-inline: 1rem;
  box-sizing: border-box;
  /* 作为 v-main 的 flex 子项时参与分配剩余空间（勿在 router-view 上挂 d-flex） */
  flex: 1 1 auto;
}

.chat_pane--state {
  grid-template-rows: 1fr;
}

.chat-body--state {
  min-height: 0;
  overflow: auto;
}

.chat-header {
  padding-top: 1rem;
  padding-bottom: 0.5rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1em;
  min-width: 0;
}

.chat-header__row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
  flex: 1;
  min-width: 0;
}

.chat-header__config {
  margin-top: 0.375rem;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.chat-header__title {
  min-width: 12rem;
}
</style>
