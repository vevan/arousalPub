<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const router = useRouter()

interface ChatListEntry {
  conversationId: string
  title: string
  updatedAt: string
}

const loading = ref(true)
const creating = ref(false)
const errorText = ref('')
const conversations = ref<ChatListEntry[]>([])

const renameOpen = ref(false)
const renameDraft = ref('')
const renameTarget = ref<ChatListEntry | null>(null)
const renameSaving = ref(false)

const deleteOpen = ref(false)
const deleteTarget = ref<ChatListEntry | null>(null)
const deleteDoing = ref(false)

async function load() {
  loading.value = true
  errorText.value = ''
  try {
    const res = await fetch('/api/chat/index')
    if (!res.ok) {
      errorText.value = t('conversationList.loadFailed')
      return
    }
    const j = (await res.json()) as { conversations?: ChatListEntry[] }
    conversations.value = j.conversations ?? []
  } catch {
    errorText.value = t('conversationList.loadFailed')
  } finally {
    loading.value = false
  }
}

async function createAndOpen() {
  if (creating.value || loading.value) return
  creating.value = true
  const id = crypto.randomUUID()
  try {
    const res = await fetch('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: id,
        title: t('chat.newConversation'),
      }),
    })
    if (!res.ok) {
      errorText.value = t('conversationList.createFailed')
      return
    }
    await router.push({ name: 'chat', params: { conversationId: id } })
  } catch {
    errorText.value = t('conversationList.createFailed')
  } finally {
    creating.value = false
  }
}

function open(id: string) {
  void router.push({ name: 'chat', params: { conversationId: id } })
}

function formatTime(iso: string) {
  try {
    const d = new Date(iso)
    return d.toLocaleString()
  } catch {
    return iso
  }
}

function openRename(c: ChatListEntry) {
  renameTarget.value = c
  renameDraft.value = c.title || t('chat.newConversation')
  renameOpen.value = true
}

function closeRename() {
  renameOpen.value = false
}

async function submitRename() {
  const c = renameTarget.value
  if (!c) return
  const title = renameDraft.value.trim()
  if (!title) return
  renameSaving.value = true
  try {
    const res = await fetch(`/api/chat/conversations/${c.conversationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    })
    if (!res.ok) {
      errorText.value = t('conversationList.renameFailed')
      return
    }
    closeRename()
    await load()
  } finally {
    renameSaving.value = false
  }
}

function openDelete(c: ChatListEntry) {
  deleteTarget.value = c
  deleteOpen.value = true
}

function closeDelete() {
  deleteOpen.value = false
}

watch(renameOpen, (open) => {
  if (!open) {
    renameDraft.value = ''
    renameTarget.value = null
  }
})

watch(deleteOpen, (open) => {
  if (!open) deleteTarget.value = null
})

async function submitDelete() {
  const c = deleteTarget.value
  if (!c) return
  deleteDoing.value = true
  try {
    const res = await fetch(`/api/chat/conversations/${c.conversationId}`, {
      method: 'DELETE',
    })
    if (!res.ok) {
      errorText.value = t('conversationList.deleteFailed')
      return
    }
    closeDelete()
    await load()
  } finally {
    deleteDoing.value = false
  }
}

onMounted(() => {
  void load()
})
</script>

<template>
  <div class="list-view flex-grow-1 d-flex flex-column min-height-0">
    <div class="list-view__inner app-page-shell">
      <header class="list-head">
        <h1 class="list-head__title">
          {{ $t('conversationList.pageTitle') }}
        </h1>
        <span class="list-head__sub">
          {{ conversations.length }} conversations
        </span>
      </header>

      <v-alert
        v-if="errorText"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-4 mx-2"
      >
        {{ errorText }}
      </v-alert>

      <div
        v-if="loading"
        class="text-body-2 text-medium-emphasis pa-4"
      >
        {{ $t('conversationList.loading') }}
      </div>

      <div
        v-else
        class="conv-grid"
      >
        <button
          type="button"
          class="conv-card conv-card--new"
          :class="{ 'is-loading': creating }"
          :disabled="creating"
          :aria-label="$t('conversationList.newChat')"
          @click="createAndOpen"
        >
          <v-progress-circular
            v-if="creating"
            indeterminate
            color="primary"
            size="36"
          />
          <template v-else>
            <span class="conv-card--new__plus">+</span>
            <span class="conv-card--new__label">{{
              $t('conversationList.newChat')
            }}</span>
          </template>
        </button>

        <article
          v-for="c in conversations"
          :key="c.conversationId"
          class="conv-card"
          tabindex="0"
          @click="open(c.conversationId)"
          @keydown.enter="open(c.conversationId)"
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
                @click="openRename(c)"
              />
              <v-list-item
                :title="$t('conversationList.delete')"
                prepend-icon="mdi-delete-outline"
                class="text-error"
                @click="openDelete(c)"
              />
            </v-list>
          </v-menu>

          <h2 class="conv-card__title">
            {{ c.title || $t('chat.newConversation') }}
          </h2>
          <div class="conv-card__meta">
            <span>{{ formatTime(c.updatedAt) }}</span>
          </div>
        </article>
      </div>
    </div>

    <v-dialog
      v-model="renameOpen"
    >
      <v-card>
        <v-card-title class="text-subtitle-1">
          {{ $t('conversationList.renameDialogTitle') }}
        </v-card-title>
        <v-card-text>
          <v-text-field
            v-model="renameDraft"
            :label="$t('chatConversation.titleLabel')"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            autofocus
            @keydown.enter.prevent="submitRename"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="closeRename"
          >
            {{ $t('settings.themeCancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="renameSaving"
            :disabled="!renameDraft.trim()"
            @click="submitRename"
          >
            {{ $t('settings.themeConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="deleteOpen"
    >
      <v-card>
        <v-card-title class="text-subtitle-1">
          {{ $t('conversationList.deleteDialogTitle') }}
        </v-card-title>
        <v-card-text class="text-body-2">
          {{
            $t('conversationList.deleteDialogBody', {
              title: deleteTarget?.title || $t('chat.newConversation'),
            })
          }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="closeDelete"
          >
            {{ $t('settings.themeCancel') }}
          </v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="deleteDoing"
            @click="submitDelete"
          >
            {{ $t('conversationList.delete') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.list-view {
  position: relative;
  padding-block: 1.75rem 2rem;
  overflow-y: auto;
}

.list-view__inner {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

.min-height-0 {
  min-height: 0;
}

/* ========== List header ========== */
.list-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 0 0 1.5rem;
  padding: 0 0.25rem 0.875rem;
  border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.06);
}
.list-head__title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 1.625rem;
  letter-spacing: 0.005em;
  color: rgb(var(--v-theme-on-surface));
}
.list-head__sub {
  font-family: var(--font-mono);
  font-size: 0.6875rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* ========== Grid ========== */
.conv-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr));
  gap: 0.75rem;
}

/* ========== Card ========== */
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

/* 左侧门帘竖线 · Tavern 签名 */
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
  gap: 0.5rem;
  margin-top: auto;
  font-family: var(--font-mono);
  font-size: 0.6563rem;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.45);
  text-transform: uppercase;
}

.conv-card__menu {
  position: absolute;
  top: 0.375rem;
  right: 0.375rem;
  z-index: 2;
  color: rgba(var(--v-theme-on-surface), 0.5) !important;
}

/* ========== New card ========== */
.conv-card--new {
  align-items: center;
  justify-content: center;
  padding: 1.75rem 1rem;
  background: transparent;
  border: 0.0625rem dashed rgba(var(--v-theme-primary), 0.35);
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.conv-card--new::before { display: none; }
.conv-card--new:not(:disabled):hover {
  background: rgba(var(--v-theme-primary), 0.04);
  border-color: rgb(var(--v-theme-primary));
  border-style: dashed;
  color: rgb(var(--v-theme-on-surface));
}
.conv-card--new__plus {
  font-family: var(--font-display);
  font-size: 2rem;
  font-weight: 400;
  color: rgb(var(--v-theme-primary));
  line-height: 1;
  margin-bottom: 0.375rem;
}
.conv-card--new__label {
  font-family: var(--font-display);
  font-size: 0.9375rem;
  font-style: italic;
  letter-spacing: 0.01em;
}
.conv-card--new:disabled {
  cursor: progress;
  opacity: 0.5;
}
</style>
