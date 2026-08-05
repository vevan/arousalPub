<script setup lang="ts">
import CharacterConversationsDialog from '@/components/home/CharacterConversationsDialog.vue'
import HomeCharacterGrid from '@/components/home/HomeCharacterGrid.vue'
import ConversationGrid from '@/components/conversation-list/ConversationGrid.vue'
import ConversationListToolbar from '@/components/conversation-list/ConversationListToolbar.vue'
import CreateConversationDialog from '@/components/conversation-list/CreateConversationDialog.vue'
import CreateConversationCharacterPicker from '@/components/conversation-list/CreateConversationCharacterPicker.vue'
import RenameConversationDialog from '@/components/conversation-list/RenameConversationDialog.vue'
import DeleteConversationDialog from '@/components/conversation-list/DeleteConversationDialog.vue'
import {
  readHomeCharacterSourceDefault,
  readHomeListModeDefault,
  type HomeListMode,
} from '@/utils/home-preferences'
import {
  consumeHomeReturnFromChat,
  markHomeReturnFromChat,
} from '@/utils/home-navigation'
import { useAsyncAction } from '@/composables/useAsyncAction'
import { useDeleteConfirmDialog } from '@/composables/useDeleteConfirmDialog'
import type { ChatListEntry } from '@/composables/conversation-list/types'
import {
  CHARACTER_SORT_OPTIONS,
  CONVERSATION_SORT_OPTIONS,
  SORT_ORDER_OPTIONS,
  useConversationListFilters,
} from '@/composables/conversation-list/use-conversation-list-filters'
import { useCreateConversation } from '@/composables/conversation-list/use-create-conversation'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const { t } = useI18n()
const router = useRouter()

const listMode = ref<HomeListMode>('conversations')
const characterSource = ref(readHomeCharacterSourceDefault())

const charConvDialogOpen = ref(false)
const charConvPickId = ref<string | null>(null)
const charConvPickName = ref('')

const { loading, errorText, run } = useAsyncAction(true)
const conversations = ref<ChatListEntry[]>([])

const {
  searchQuery,
  characterSearchQuery,
  conversationSort,
  conversationSortOrder,
  characterSort,
  characterSortOrder,
  filteredConversations,
  conversationSortLabel,
  characterSortLabel,
  sortOrderLabel,
  sortOrderIcon,
  setConversationSort,
  setCharacterSort,
  setConversationSortOrder,
  setCharacterSortOrder,
  clearSearchQueries,
} = useConversationListFilters(conversations)

const {
  createOpen,
  creating,
  createErrorText,
  createTitleDraft,
  charItemsLoading,
  selectedUserCard,
  selectedCharacterCards,
  pickerOpen,
  pickerTarget,
  userPickerOnlyMarked,
  characterPickerExcludeUser,
  lorebookItems,
  lorebookItemsLoading,
  selectedLorebookIds,
  displayedCharItems,
  canStartCreate,
  characterImage,
  openCreateDialog,
  closeCreateDialog,
  openUserPicker,
  openCharacterPicker,
  selectCharacter,
  addCharacterSlot,
  removeCharacterSlot,
  createAndOpen,
} = useCreateConversation()

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
  clearSearchQueries()
}

function onCharacterPick(payload: { id: string; name: string }) {
  charConvPickId.value = payload.id
  charConvPickName.value = payload.name
  charConvDialogOpen.value = true
}

async function load() {
  await run(async () => {
    try {
      const res = await fetch('/api/chat/index')
      if (!res.ok) throw new Error('fail')
      const j = (await res.json()) as { conversations?: ChatListEntry[] }
      conversations.value = j.conversations ?? []
    } catch {
      throw new Error(t('conversationList.loadFailed'))
    }
  })
}

function open(id: string) {
  markHomeReturnFromChat()
  void router.push({ name: 'chat', params: { conversationId: id } })
}

const renameOpen = ref(false)
const renameDraft = ref('')
const renameTarget = ref<ChatListEntry | null>(null)
const renameSaving = ref(false)

const {
  open: deleteOpen,
  targetLabel: deleteTargetLabel,
  confirming: deleteDoing,
  askDelete,
  close: closeDelete,
  confirm: confirmDelete,
} = useDeleteConfirmDialog()

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
  askDelete(c.conversationId, c.title)
}

watch(renameOpen, (open) => {
  if (!open) {
    renameDraft.value = ''
    renameTarget.value = null
  }
})

async function submitDelete() {
  try {
    const ok = await confirmDelete(async (id) => {
      const res = await fetch(`/api/chat/conversations/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(t('conversationList.deleteFailed'))
    })
    if (ok) await load()
  } catch (e) {
    errorText.value =
      e instanceof Error && e.message
        ? e.message
        : t('conversationList.deleteFailed')
  }
}

function enterHomeWithDefaults() {
  applyHomeSessionDefaults()
  void load()
}

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

      <ConversationListToolbar
        v-if="listMode === 'conversations' && !loading && conversations.length > 0"
        v-model:search-query="searchQuery"
        :search-placeholder="$t('conversationList.searchPlaceholder')"
        :sort-label="conversationSortLabel(conversationSort)"
        :sort-order="conversationSortOrder"
        :sort-options="CONVERSATION_SORT_OPTIONS"
        :active-sort="conversationSort"
        :sort-option-label="(opt) => conversationSortLabel(opt as typeof conversationSort)"
        :sort-order-options="SORT_ORDER_OPTIONS"
        :sort-order-label="sortOrderLabel"
        :sort-order-icon="sortOrderIcon"
        @update:sort="setConversationSort($event as typeof conversationSort)"
        @update:sort-order="setConversationSortOrder"
      />

      <ConversationListToolbar
        v-if="listMode === 'characters'"
        v-model:search-query="characterSearchQuery"
        :search-placeholder="$t('home.characterSearchPlaceholder')"
        :sort-label="characterSortLabel(characterSort)"
        :sort-order="characterSortOrder"
        :sort-options="CHARACTER_SORT_OPTIONS"
        :active-sort="characterSort"
        :sort-option-label="(opt) => characterSortLabel(opt as typeof characterSort)"
        :sort-order-options="SORT_ORDER_OPTIONS"
        :sort-order-label="sortOrderLabel"
        :sort-order-icon="sortOrderIcon"
        @update:sort="setCharacterSort($event as typeof characterSort)"
        @update:sort-order="setCharacterSortOrder"
      />

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
        :sort="characterSort"
        :sort-order="characterSortOrder"
        @pick="onCharacterPick"
      />

      <div
        v-else-if="loading"
        class="text-body-2 text-medium-emphasis pa-4"
      >
        {{ $t('conversationList.loading') }}
      </div>

      <ConversationGrid
        v-else
        :conversations="filteredConversations"
        :creating="creating"
        @create="openCreateDialog"
        @open="open"
        @rename="openRename"
        @delete="openDelete"
      />
    </div>

    <CharacterConversationsDialog
      v-model="charConvDialogOpen"
      :character-id="charConvPickId"
      :character-name="charConvPickName"
      :conversations="conversations"
    />

    <CreateConversationDialog
      v-model="createOpen"
      v-model:create-title-draft="createTitleDraft"
      v-model:selected-lorebook-ids="selectedLorebookIds"
      :create-error-text="createErrorText"
      :selected-user-card="selectedUserCard"
      :selected-character-cards="selectedCharacterCards"
      :lorebook-items="lorebookItems"
      :lorebook-items-loading="lorebookItemsLoading"
      :creating="creating"
      :can-start-create="canStartCreate"
      :character-image="characterImage"
      @close="closeCreateDialog"
      @open-user-picker="openUserPicker"
      @open-character-picker="openCharacterPicker"
      @add-character-slot="addCharacterSlot"
      @remove-character-slot="removeCharacterSlot"
      @submit="createAndOpen(loading)"
    />

    <CreateConversationCharacterPicker
      v-model="pickerOpen"
      v-model:user-picker-only-marked="userPickerOnlyMarked"
      v-model:character-picker-exclude-user="characterPickerExcludeUser"
      :picker-kind="pickerTarget?.kind ?? null"
      :char-items-loading="charItemsLoading"
      :displayed-char-items="displayedCharItems"
      :character-image="characterImage"
      @select="selectCharacter"
    />

    <RenameConversationDialog
      v-model="renameOpen"
      v-model:draft="renameDraft"
      :saving="renameSaving"
      @submit="submitRename"
      @cancel="closeRename"
    />

    <DeleteConversationDialog
      v-model="deleteOpen"
      :target-label="deleteTargetLabel"
      :confirming="deleteDoing"
      @confirm="submitDelete"
      @cancel="closeDelete"
    />
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
</style>
