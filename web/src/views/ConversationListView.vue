<script setup lang="ts">
import { characterImageUrl } from '@/utils/authenticated-media-url'
import { generateConversationId } from '@/utils/conversation-id'
import { allocateShortId } from '@/utils/short-id'
import { pickDefaultLorebookIds, fetchLorebookPickerItems } from '@/utils/default-lorebook'
import CharacterConversationsDialog from '@/components/home/CharacterConversationsDialog.vue'
import HomeCharacterGrid from '@/components/home/HomeCharacterGrid.vue'
import {
  readHomeCharacterSourceDefault,
  readHomeListModeDefault,
  type HomeListMode,
} from '@/utils/home-preferences'
import {
  consumeHomeReturnFromChat,
  markHomeReturnFromChat,
} from '@/utils/home-navigation'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const { t } = useI18n()
const router = useRouter()
const auth = useAuthStore()

const listMode = ref<HomeListMode>('conversations')
const characterSource = ref(readHomeCharacterSourceDefault())
const characterSearchQuery = ref('')

const charConvDialogOpen = ref(false)
const charConvPickId = ref<string | null>(null)
const charConvPickName = ref('')

interface ChatListEntry {
  conversationId: string
  title: string
  updatedAt: string
  userName?: string
  userCharacterId?: string
  characterId?: string | null
  characterIds?: string[]
  characterNames?: string[]
  searchTags?: string[]
}

const createTitleDraft = ref('')

const loading = ref(true)
const creating = ref(false)
const errorText = ref('')
const conversations = ref<ChatListEntry[]>([])
const searchQuery = ref('')

function matchesConversationSearch(c: ChatListEntry, q: string): boolean {
  if (!q) return true
  if (c.title.toLowerCase().includes(q)) return true
  const userName = c.userName?.trim()
  if (userName && userName.toLowerCase().includes(q)) return true
  if (c.characterNames?.some((n) => n.toLowerCase().includes(q))) return true
  if (c.searchTags?.some((t) => t.toLowerCase().includes(q))) return true
  return false
}

const filteredConversations = computed(() => {
  const q = searchQuery.value.trim().toLowerCase()
  if (!q) return conversations.value
  return conversations.value.filter((c) => matchesConversationSearch(c, q))
})

const displayedCount = computed(() => filteredConversations.value.length)

const pageTitle = computed(() =>
  listMode.value === 'characters'
    ? t('home.charactersPageTitle')
    : t('conversationList.pageTitle'),
)

const headCountLabel = computed(() => {
  if (listMode.value === 'characters') return ''
  if (searchQuery.value.trim()) {
    return t('conversationList.countFiltered', {
      n: displayedCount.value,
      total: conversations.value.length,
    })
  }
  return t('conversationList.count', { n: conversations.value.length })
})

function applyHomeSessionDefaults() {
  listMode.value = readHomeListModeDefault()
  characterSource.value = readHomeCharacterSourceDefault()
  searchQuery.value = ''
  characterSearchQuery.value = ''
}

function onCharacterPick(payload: { id: string; name: string }) {
  charConvPickId.value = payload.id
  charConvPickName.value = payload.name
  charConvDialogOpen.value = true
}

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

interface LorebookPickerItem {
  id: string
  name: string
}

const lorebookItems = ref<LorebookPickerItem[]>([])
const lorebookItemsLoading = ref(false)
const selectedLorebookIds = ref<string[]>([])

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
        title: createTitleDraft.value.trim(),
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
        lorebookIds: [...selectedLorebookIds.value],
      }),
    })
    if (!patch.ok) {
      createErrorText.value = t('conversationList.createFailed')
      return
    }
    const mainDoc = await fetchCharacterDetail(mainCharacter.id)
    const greetings = collectOpeningGreetings(mainDoc?.card)
    if (greetings.length > 0) {
      const used = new Set<string>()
      const opening = await fetch(`/api/chat/conversations/${id}/opening`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          receives: greetings.map((content) => ({
            id: allocateShortId(used),
            content,
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
    markHomeReturnFromChat()
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
  () =>
    Boolean(
      selectedUserCard.value &&
        selectedCharacterCards.value[0] &&
        createTitleDraft.value.trim(),
    ) && !creating.value,
)

function openCreateDialog() {
  createErrorText.value = ''
  createTitleDraft.value = ''
  selectedUserCard.value = null
  selectedCharacterCards.value = [null]
  selectedLorebookIds.value = pickDefaultLorebookIds(lorebookItems.value)
  createOpen.value = true
  void loadCharacterItems()
  void loadLorebookItems()
}

async function loadLorebookItems() {
  if (lorebookItemsLoading.value) return
  lorebookItemsLoading.value = true
  try {
    lorebookItems.value = await fetchLorebookPickerItems()
    if (createOpen.value && selectedLorebookIds.value.length === 0) {
      selectedLorebookIds.value = pickDefaultLorebookIds(lorebookItems.value)
    }
  } finally {
    lorebookItemsLoading.value = false
  }
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
    if (target.index === 0 && !createTitleDraft.value.trim()) {
      createTitleDraft.value = item.name
    }
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
  return (
    characterImageUrl(auth.user?.id ?? auth.defaultUserId, id, { size: 'm' }) ??
    ''
  )
}

function primaryCharacterId(c: ChatListEntry): string | null {
  const fromList = c.characterIds?.find((id) => typeof id === 'string' && id.trim())
  if (fromList) return fromList.trim()
  if (typeof c.characterId === 'string' && c.characterId.trim()) {
    return c.characterId.trim()
  }
  return null
}

function userCharacterId(c: ChatListEntry): string | null {
  if (typeof c.userCharacterId === 'string' && c.userCharacterId.trim()) {
    return c.userCharacterId.trim()
  }
  return null
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
  markHomeReturnFromChat()
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

/** 从侧栏/其它路由进入首页：恢复设置默认 + 清空快查 */
function enterHomeWithDefaults() {
  applyHomeSessionDefaults()
  void load()
}

/** 从对话页返回：恢复设置默认视图并刷新列表（仍后台拉取 conversations） */
function restoreHomeAfterChat() {
  applyHomeSessionDefaults()
  void load()
}

function setupHomeRouteHooks() {
  return router.afterEach((to, from) => {
    if (to.name !== 'home') return
    if (from.name === 'chat') {
      restoreHomeAfterChat()
      return
    }
    if (from.name && from.name !== 'home') {
      enterHomeWithDefaults()
    }
  })
}

let removeHomeRouteHook: (() => void) | undefined

onMounted(() => {
  removeHomeRouteHook = setupHomeRouteHooks()
  if (consumeHomeReturnFromChat()) {
    restoreHomeAfterChat()
  } else {
    enterHomeWithDefaults()
  }
})

onUnmounted(() => {
  removeHomeRouteHook?.()
})
</script>

<template>
  <div class="list-view flex-grow-1 d-flex flex-column min-height-0">
    <div class="list-view__inner app-page-shell">
      <header class="list-head">
        <div class="list-head__main">
          <h1 class="list-head__title">
            {{ pageTitle }}
          </h1>
          <span
            v-if="headCountLabel"
            class="list-head__sub"
          >
            {{ headCountLabel }}
          </span>
        </div>
        <v-btn-toggle
          v-model="listMode"
          mandatory
          divided
          density="compact"
          variant="outlined"
          class="list-head__toggle"
        >
          <v-btn value="conversations" size="small">
            {{ $t('home.listModeConversations') }}
          </v-btn>
          <v-btn value="characters" size="small">
            {{ $t('home.listModeCharacters') }}
          </v-btn>
        </v-btn-toggle>
      </header>

      <label
        v-if="listMode === 'conversations' && !loading && conversations.length > 0"
        class="list-search"
      >
        <v-icon size="16" class="list-search__icon">mdi-magnify</v-icon>
        <input
          v-model="searchQuery"
          type="search"
          class="list-search__input"
          :placeholder="$t('conversationList.searchPlaceholder')"
          :aria-label="$t('conversationList.searchPlaceholder')"
        />
        <button
          v-if="searchQuery.trim()"
          type="button"
          class="list-search__clear"
          :aria-label="$t('conversationList.searchClear')"
          @click="searchQuery = ''"
        >
          <v-icon size="16">mdi-close</v-icon>
        </button>
      </label>

      <label
        v-if="listMode === 'characters'"
        class="list-search"
      >
        <v-icon size="16" class="list-search__icon">mdi-magnify</v-icon>
        <input
          v-model="characterSearchQuery"
          type="search"
          class="list-search__input"
          :placeholder="$t('home.characterSearchPlaceholder')"
          :aria-label="$t('home.characterSearchPlaceholder')"
        />
        <button
          v-if="characterSearchQuery.trim()"
          type="button"
          class="list-search__clear"
          :aria-label="$t('conversationList.searchClear')"
          @click="characterSearchQuery = ''"
        >
          <v-icon size="16">mdi-close</v-icon>
        </button>
      </label>

      <v-alert
        v-if="errorText"
        type="error"
        variant="tonal"
        density="compact"
        class="mb-4 mx-2"
      >
        {{ errorText }}
      </v-alert>

      <HomeCharacterGrid
        v-if="listMode === 'characters'"
        :character-source="characterSource"
        :search-query="characterSearchQuery"
        @pick="onCharacterPick"
      />

      <div
        v-else-if="loading"
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
          v-for="c in filteredConversations"
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

          <div
            v-if="userCharacterId(c) || primaryCharacterId(c)"
            class="conv-card__avatars"
            aria-hidden="true"
          >
            <img
              v-if="userCharacterId(c)"
              class="conv-card__avatar conv-card__avatar--user"
              :src="characterImage(userCharacterId(c)!)"
              alt=""
            />
            <img
              v-if="primaryCharacterId(c)"
              class="conv-card__avatar conv-card__avatar--char"
              :src="characterImage(primaryCharacterId(c)!)"
              alt=""
            />
          </div>

          <h2 class="conv-card__title">
            {{ c.title || $t('chat.newConversation') }}
          </h2>
          <div class="conv-card__meta">
            <span>{{ formatTime(c.updatedAt) }}</span>
          </div>
        </article>
      </div>
    </div>

    <CharacterConversationsDialog
      v-model="charConvDialogOpen"
      :character-id="charConvPickId"
      :character-name="charConvPickName"
      :conversations="conversations"
    />

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

          <v-text-field
            v-model="createTitleDraft"
            :label="$t('chatConversation.titleLabel')"
            :placeholder="$t('conversationList.createTitlePlaceholder')"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            class="mb-4"
            autofocus
            @keydown.enter.prevent="canStartCreate && createAndOpen()"
          />

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

            <section class="create-slot-section">
              <h3 class="create-slot-section__title">
                {{ $t('conversationList.lorebookSlotTitle') }}
              </h3>
              <v-select
                v-model="selectedLorebookIds"
                :items="lorebookItems"
                item-title="name"
                item-value="id"
                :label="$t('conversationList.lorebookSelectLabel')"
                :hint="$t('conversationList.lorebookSelectHint')"
                persistent-hint
                multiple
                chips
                closable-chips
                density="comfortable"
                variant="outlined"
                hide-details="auto"
                :loading="lorebookItemsLoading"
              />
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

.list-search {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  height: 2.25rem;
  margin: 0 0.25rem 0.75rem;
  padding: 0 0.75rem;
  border-radius: 0.5rem;
  border: 0.0625rem solid rgba(var(--v-theme-primary), 0.45);
  background: rgba(var(--v-theme-on-surface), 0.04);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.list-search:focus-within {
  border-color: rgb(var(--v-theme-primary));
  box-shadow: 0 0 0 0.125rem rgba(var(--v-theme-primary), 0.12);
}

.list-search__icon {
  flex-shrink: 0;
  color: rgb(var(--v-theme-primary));
  opacity: 0.85;
}

.list-search__input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
}

.list-search__input::-webkit-search-cancel-button {
  display: none;
}

.list-search__clear {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  background: transparent;
  color: rgba(var(--v-theme-on-surface), 0.55);
  cursor: pointer;
  border-radius: 0.25rem;
}

.list-search__clear:hover {
  color: rgb(var(--v-theme-on-surface));
}

.min-height-0 {
  min-height: 0;
}

/* ========== List header ========== */
.list-head {
  flex: 0 0 auto;
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 0.75rem 1rem;
  margin: 0 0 1.5rem;
  padding: 0 0.25rem 0.875rem;
  border-bottom: 0.0625rem solid rgba(var(--v-theme-on-surface), 0.06);
}
.list-head__main {
  display: flex;
  align-items: baseline;
  gap: 0.75rem;
  flex-wrap: wrap;
  min-width: 0;
}
.list-head__toggle {
  flex-shrink: 0;
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
  flex: 0 0 auto;
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

.conv-card__avatars {
  display: flex;
  align-items: center;
  margin-bottom: 0.625rem;
}

.conv-card__avatar {
  width: 2rem;
  height: 2rem;
  border-radius: 50%;
  object-fit: cover;
  border: 0.125rem solid rgb(var(--v-theme-surface-light));
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.conv-card__avatar--char {
  margin-left: -0.5rem;
}

.conv-card__avatar--user {
  z-index: 1;
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
