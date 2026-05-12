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
  <div class="list-view flex-grow-1 d-flex flex-column min-height-0 pa-4">
    <div class="list-view__inner mx-auto w-100">
      <h1 class="text-h6 font-weight-medium mb-4">
        {{ $t('conversationList.pageTitle') }}
      </h1>

      <v-alert
        v-if="errorText"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-4"
      >
        {{ errorText }}
      </v-alert>

      <div
        v-if="loading"
        class="text-body-2 text-medium-emphasis"
      >
        {{ $t('conversationList.loading') }}
      </div>

      <v-row v-else>
        <v-col
          cols="12"
          sm="6"
          md="4"
        >
          <v-card
            variant="outlined"
            class="conv-card conv-card--new h-100 d-flex flex-column align-center justify-center"
            :class="{ 'cursor-pointer': !creating, 'opacity-50': creating }"
            :ripple="!creating"
            @click="createAndOpen"
          >
            <v-card-text class="text-center py-8 flex-grow-0">
              <v-progress-circular
                v-if="creating"
                indeterminate
                color="primary"
                size="40"
              />
              <template v-else>
                <v-icon
                  size="40"
                  color="primary"
                >
                  mdi-plus
                </v-icon>
                <div class="text-subtitle-2 mt-3">
                  {{ $t('conversationList.newChat') }}
                </div>
              </template>
            </v-card-text>
          </v-card>
        </v-col>

        <v-col
          v-for="c in conversations"
          :key="c.conversationId"
          cols="12"
          sm="6"
          md="4"
        >
          <v-card
            variant="outlined"
            class="conv-card h-100 position-relative"
          >
            <v-menu location="bottom end">
              <template #activator="{ props: menuProps }">
                <v-btn
                  class="conv-card__menu"
                  icon="mdi-dots-vertical"
                  variant="text"
                  size="small"
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

            <div
              class="conv-card__body pa-4 cursor-pointer"
              @click="open(c.conversationId)"
            >
              <div class="text-subtitle-1 text-truncate pr-8">
                {{ c.title || $t('chat.newConversation') }}
              </div>
              <div class="text-caption text-medium-emphasis mt-1">
                {{ formatTime(c.updatedAt) }}
              </div>
            </div>
          </v-card>
        </v-col>
      </v-row>
    </div>

    <v-dialog
      v-model="renameOpen"
      max-width="28rem"
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
      max-width="24rem"
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
}

.list-view__inner {
  max-width: 56rem;
}

.min-height-0 {
  min-height: 0;
}

.conv-card {
  transition: border-color 0.15s ease;
}

.conv-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
}

.conv-card--new {
  min-height: 7.5rem;
}

.cursor-pointer {
  cursor: pointer;
}

.conv-card__menu {
  position: absolute;
  top: 0.125rem;
  right: 0.125rem;
  z-index: 2;
}

.conv-card__body {
  min-height: 5.5rem;
}
</style>
