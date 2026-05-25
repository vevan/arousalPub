<script setup lang="ts">
import { generateConversationId } from '@/utils/conversation-id'
import {
  applyPromptMacroPipeline,
  buildPromptMacroContext,
} from '@/utils/prompt-macros'
import { computed, onMounted, ref, watch } from 'vue'
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

interface CharacterPickerItem {
  id: string
  name: string
  summary: string
}

interface CharacterStoredDocument {
  id: string
  card: Record<string, unknown>
}

const createOpen = ref(false)
const createErrorText = ref('')
const charItems = ref<CharacterPickerItem[]>([])
const charItemsLoading = ref(false)
const selectedUserCard = ref<CharacterPickerItem | null>(null)
const selectedCharacterCards = ref<(CharacterPickerItem | null)[]>([null])
const pickerOpen = ref(false)
const pickerTarget = ref<{ kind: 'user' } | { kind: 'character'; index: number } | null>(null)

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
  if (creating.value || loading.value || !canStartCreate.value) return
  creating.value = true
  const id = generateConversationId()
  const userCard = selectedUserCard.value
  const characters = selectedCharacters.value
  const mainCharacter = characters[0]
  createErrorText.value = ''
  if (!userCard || !mainCharacter) {
    creating.value = false
    return
  }
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
      createErrorText.value = t('conversationList.createFailed')
      return
    }
    const patch = await fetch(`/api/chat/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userCharacterId: userCard.id,
        userName: userCard.name,
        characterIds: characters.map((c) => c.id),
      }),
    })
    if (!patch.ok) {
      createErrorText.value = t('conversationList.createFailed')
      return
    }
    const mainDoc = await fetchCharacterDetail(mainCharacter.id)
    const greetings = collectOpeningGreetings(mainDoc?.card)
    if (greetings.length > 0) {
      const macroContext = buildPromptMacroContext({
        conversationUserName: userCard.name,
        characters,
      })
      const opening = await fetch(`/api/chat/conversations/${id}/opening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receives: greetings.map((content) => ({
            id: crypto.randomUUID(),
            content: applyPromptMacroPipeline(content, macroContext),
          })),
          activeReceiveIndex: 0,
        }),
      })
      if (!opening.ok) {
        createErrorText.value = t('conversationList.createFailed')
        return
      }
    }
    closeCreateDialog()
    await router.push({ name: 'chat', params: { conversationId: id } })
  } catch {
    createErrorText.value = t('conversationList.createFailed')
  } finally {
    creating.value = false
  }
}

const selectedCharacters = computed(() =>
  selectedCharacterCards.value.filter((c): c is CharacterPickerItem => Boolean(c)),
)

const canStartCreate = computed(
  () => Boolean(selectedUserCard.value && selectedCharacterCards.value[0]) && !creating.value,
)

function openCreateDialog() {
  createErrorText.value = ''
  selectedUserCard.value = null
  selectedCharacterCards.value = [null]
  createOpen.value = true
  void loadCharacterItems()
}

function closeCreateDialog() {
  createOpen.value = false
  pickerOpen.value = false
  pickerTarget.value = null
}

async function loadCharacterItems() {
  if (charItemsLoading.value || charItems.value.length > 0) return
  charItemsLoading.value = true
  try {
    const res = await fetch('/api/characters?limit=200&offset=0')
    if (!res.ok) return
    const j = (await res.json()) as {
      items?: { id?: string; name?: string; summary?: string }[]
    }
    charItems.value = (j.items ?? [])
      .filter((x) => typeof x.id === 'string' && x.id.trim())
      .map((x) => ({
        id: x.id as string,
        name: typeof x.name === 'string' && x.name.trim() ? x.name.trim() : (x.id as string),
        summary: typeof x.summary === 'string' ? x.summary : '',
      }))
  } finally {
    charItemsLoading.value = false
  }
}

function openUserPicker() {
  pickerTarget.value = { kind: 'user' }
  pickerOpen.value = true
  void loadCharacterItems()
}

function openCharacterPicker(index: number) {
  pickerTarget.value = { kind: 'character', index }
  pickerOpen.value = true
  void loadCharacterItems()
}

function selectCharacter(item: CharacterPickerItem) {
  const target = pickerTarget.value
  if (!target) return
  if (target.kind === 'user') {
    selectedUserCard.value = item
  } else {
    selectedCharacterCards.value[target.index] = item
  }
  pickerOpen.value = false
  pickerTarget.value = null
}

function addCharacterSlot() {
  selectedCharacterCards.value.push(null)
}

function removeCharacterSlot(index: number) {
  if (selectedCharacterCards.value.length <= 1) {
    selectedCharacterCards.value = [null]
    return
  }
  selectedCharacterCards.value.splice(index, 1)
}

function characterImage(id: string) {
  return `/api/characters/${id}/image`
}

async function fetchCharacterDetail(id: string): Promise<CharacterStoredDocument | null> {
  try {
    const res = await fetch(`/api/characters/${id}`)
    if (!res.ok) return null
    return (await res.json()) as CharacterStoredDocument
  } catch {
    return null
  }
}

function stringField(card: Record<string, unknown> | undefined, key: string): string {
  const v = card?.[key]
  return typeof v === 'string' ? v.trim() : ''
}

function collectOpeningGreetings(card: Record<string, unknown> | undefined): string[] {
  const out: string[] = []
  const first = stringField(card, 'first_mes')
  if (first) out.push(first)
  const alt = card?.alternate_greetings
  if (Array.isArray(alt)) {
    for (const raw of alt) {
      const text = typeof raw === 'string' ? raw.trim() : ''
      if (text) out.push(text)
    }
  }
  return out
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
          @click="openCreateDialog"
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
      v-model="createOpen"
      max-width="58rem"
      scrollable
    >
      <v-card class="create-chat-card">
        <v-card-title class="text-subtitle-1">
          {{ $t('conversationList.createDialogTitle') }}
        </v-card-title>
        <v-card-text>
          <v-alert
            v-if="createErrorText"
            type="error"
            density="compact"
            variant="tonal"
            class="mb-3"
          >
            {{ createErrorText }}
          </v-alert>

          <p class="create-chat-card__hint">
            {{ $t('conversationList.createDialogHint') }}
          </p>

          <div class="create-slots">
            <section class="create-slot-section">
              <h3 class="create-slot-section__title">
                {{ $t('conversationList.userSlotTitle') }}
              </h3>
              <button
                type="button"
                class="create-slot-card"
                :class="{ 'is-filled': selectedUserCard }"
                @click="openUserPicker"
              >
                <template v-if="selectedUserCard">
                  <img
                    class="create-slot-card__avatar"
                    :src="characterImage(selectedUserCard.id)"
                    alt=""
                  />
                  <span class="create-slot-card__name">{{ selectedUserCard.name }}</span>
                  <span class="create-slot-card__meta">{{ $t('conversationList.userSlotMeta') }}</span>
                </template>
                <template v-else>
                  <span class="create-slot-card__plus">+</span>
                  <span>{{ $t('conversationList.pickUserCard') }}</span>
                </template>
              </button>
            </section>

            <section class="create-slot-section">
              <div class="create-slot-section__head">
                <h3 class="create-slot-section__title">
                  {{ $t('conversationList.characterSlotsTitle') }}
                </h3>
                <v-btn
                  size="small"
                  variant="text"
                  prepend-icon="mdi-plus"
                  @click="addCharacterSlot"
                >
                  {{ $t('conversationList.addCharacterSlot') }}
                </v-btn>
              </div>
              <div class="create-character-slots">
                <button
                  v-for="(card, i) in selectedCharacterCards"
                  :key="i"
                  type="button"
                  class="create-slot-card"
                  :class="{ 'is-filled': card }"
                  @click="openCharacterPicker(i)"
                >
                  <template v-if="card">
                    <img
                      class="create-slot-card__avatar"
                      :src="characterImage(card.id)"
                      alt=""
                    />
                    <span class="create-slot-card__name">{{ card.name }}</span>
                    <span class="create-slot-card__meta">
                      {{ i === 0 ? $t('conversationList.primaryCharacterMeta') : $t('conversationList.extraCharacterMeta', { n: i + 1 }) }}
                    </span>
                  </template>
                  <template v-else>
                    <span class="create-slot-card__plus">+</span>
                    <span>
                      {{ i === 0 ? $t('conversationList.pickPrimaryCharacter') : $t('conversationList.pickExtraCharacter', { n: i + 1 }) }}
                    </span>
                  </template>
                  <v-btn
                    v-if="selectedCharacterCards.length > 1"
                    class="create-slot-card__remove"
                    icon="mdi-close"
                    variant="text"
                    size="x-small"
                    @click.stop="removeCharacterSlot(i)"
                  />
                </button>
              </div>
            </section>
          </div>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="closeCreateDialog"
          >
            {{ $t('settings.themeCancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="creating"
            :disabled="!canStartCreate"
            @click="createAndOpen"
          >
            {{ $t('conversationList.startChat') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog
      v-model="pickerOpen"
      max-width="34rem"
      scrollable
    >
      <v-card>
        <v-card-title class="text-subtitle-1">
          {{ $t('conversationList.pickCharacterDialogTitle') }}
        </v-card-title>
        <v-card-text>
          <div
            v-if="charItemsLoading"
            class="text-body-2 text-medium-emphasis pa-3"
          >
            {{ $t('conversationList.loadingCharacters') }}
          </div>
          <v-list
            v-else
            class="create-picker-list"
            density="comfortable"
          >
            <v-list-item
              v-for="item in charItems"
              :key="item.id"
              :title="item.name"
              :subtitle="item.summary"
              @click="selectCharacter(item)"
            >
              <template #prepend>
                <v-avatar size="40">
                  <v-img :src="characterImage(item.id)" />
                </v-avatar>
              </template>
            </v-list-item>
          </v-list>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            @click="pickerOpen = false"
          >
            {{ $t('settings.themeCancel') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

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

.create-chat-card__hint {
  margin: 0 0 1rem;
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.8125rem;
  line-height: 1.5;
}
.create-slots {
  display: flex;
  flex-direction: column;
  gap: 1.125rem;
}
.create-slot-section__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}
.create-slot-section__title {
  margin: 0 0 0.5rem;
  font-family: var(--font-display);
  font-size: 1rem;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
}
.create-slot-section__head .create-slot-section__title {
  margin-bottom: 0;
}
.create-character-slots {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(10.5rem, 1fr));
  gap: 0.75rem;
}
.create-slot-card {
  position: relative;
  min-height: 8rem;
  padding: 0.875rem;
  border: 0.0625rem dashed rgba(var(--v-theme-on-surface), 0.18);
  border-radius: var(--radius);
  background: rgba(var(--v-theme-surface-light), 0.6);
  color: rgba(var(--v-theme-on-surface), 0.7);
  font: inherit;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  text-align: center;
  transition: border-color 0.15s ease, background 0.15s ease;
}
.create-slot-card:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
  background: rgba(var(--v-theme-primary), 0.05);
}
.create-slot-card.is-filled {
  border-style: solid;
  border-color: rgba(var(--v-theme-on-surface), 0.10);
  background: rgb(var(--v-theme-surface-light));
  color: rgb(var(--v-theme-on-surface));
}
.create-slot-card__plus {
  color: rgb(var(--v-theme-primary));
  font-family: var(--font-display);
  font-size: 2rem;
  line-height: 1;
}
.create-slot-card__avatar {
  width: 3.25rem;
  height: 3.25rem;
  border-radius: 50%;
  object-fit: cover;
  border: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.10);
}
.create-slot-card__name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 600;
}
.create-slot-card__meta {
  color: rgba(var(--v-theme-on-surface), 0.48);
  font-family: var(--font-mono);
  font-size: 0.6875rem;
}
.create-slot-card__remove {
  position: absolute;
  top: 0.25rem;
  right: 0.25rem;
}
.create-picker-list {
  background: transparent;
}
</style>
