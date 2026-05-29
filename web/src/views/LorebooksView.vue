<script setup lang="ts">
import { useLorebooksStore } from '@/stores/lorebooks'
import type { LorebookGroup } from '@/stores/lorebooks'
import {
  entryKeysInputDisabled,
  formatLorebookKeysInput,
  lorebookEntryMissingKeywords,
  parseLorebookKeysInput,
  patchForTriggerMode,
  resolveEntryTriggerMode,
  type LorebookTriggerMode,
} from '@/utils/lorebook-entry'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

withDefaults(
  defineProps<{ embedded?: boolean }>(),
  { embedded: false },
)

const { t } = useI18n()
const store = useLorebooksStore()
onMounted(() => {
  void store.loadFromServer()
})

const {
  lorebooks,
  activeLorebookId,
  activeGroupId,
  selectedEntryId,
  searchText,
  activeLorebook,
  activeGroups,
  visibleEntries,
  groupCounts,
  selectedEntry,
  loading,
  saving,
  lastError,
} = storeToRefs(store)

const currentGroup = computed(() =>
  activeGroups.value.find((g) => g.id === activeGroupId.value) ?? null,
)

/** ============== lorebook bar (preset bar) ============== */
const lorebookSwitchOpen = ref(false)
const lorebookCreateOpen = ref(false)
const lorebookCreateName = ref('')
const lorebookRenameOpen = ref(false)
const lorebookRenameDraft = ref('')
const lorebookDeleteOpen = ref(false)

function openCreateLorebook() {
  lorebookCreateName.value = ''
  lorebookCreateOpen.value = true
}
function submitCreateLorebook() {
  if (!lorebookCreateName.value.trim()) return
  store.createLorebook(lorebookCreateName.value)
  lorebookCreateOpen.value = false
}
function openRenameLorebook() {
  lorebookRenameDraft.value = activeLorebook.value.name
  lorebookRenameOpen.value = true
}
function submitRenameLorebook() {
  store.renameLorebook(activeLorebookId.value, lorebookRenameDraft.value)
  lorebookRenameOpen.value = false
}
function openDeleteLorebook() {
  if (lorebooks.value.length <= 1) return
  lorebookDeleteOpen.value = true
}
function performDeleteLorebook() {
  store.deleteLorebook(activeLorebookId.value)
  lorebookDeleteOpen.value = false
}
function switchLorebook(id: string) {
  store.selectLorebook(id)
  lorebookSwitchOpen.value = false
}

/** ============== groups bar ============== */
const groupDragId = ref<string | null>(null)
const groupDragOverIdx = ref<number | null>(null)

function onGroupDragStart(id: string, evt: DragEvent) {
  groupDragId.value = id
  if (evt.dataTransfer) {
    evt.dataTransfer.effectAllowed = 'move'
    evt.dataTransfer.setData('text/plain', id)
  }
}
function onGroupDragOver(idx: number, evt: DragEvent) {
  if (!groupDragId.value) return
  evt.preventDefault()
  if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move'
  groupDragOverIdx.value = idx
}
function onGroupDrop(idx: number) {
  if (!groupDragId.value) return
  store.reorderGroup(groupDragId.value, idx)
  groupDragId.value = null
  groupDragOverIdx.value = null
}
function onGroupDragEnd() {
  groupDragId.value = null
  groupDragOverIdx.value = null
}

const groupAddOpen = ref(false)
const groupAddName = ref('')
const groupRenameOpen = ref(false)
const groupRenameDraft = ref('')
const groupRenameTarget = ref<LorebookGroup | null>(null)
const groupDeleteOpen = ref(false)
const groupDeleteTarget = ref<LorebookGroup | null>(null)

function openAddGroup() {
  groupAddName.value = ''
  groupAddOpen.value = true
}
function submitAddGroup() {
  const g = store.addGroup(groupAddName.value)
  if (g) {
    store.selectGroup(g.id)
    groupAddOpen.value = false
  }
}
function openRenameGroup(g: LorebookGroup) {
  groupRenameTarget.value = g
  groupRenameDraft.value = g.name
  groupRenameOpen.value = true
}
function submitRenameGroup() {
  if (!groupRenameTarget.value) return
  store.renameGroup(groupRenameTarget.value.id, groupRenameDraft.value)
  groupRenameOpen.value = false
}
function openDeleteGroup(g: LorebookGroup) {
  groupDeleteTarget.value = g
  groupDeleteOpen.value = true
}
function performDeleteGroup() {
  if (!groupDeleteTarget.value) return
  store.deleteGroup(groupDeleteTarget.value.id)
  groupDeleteOpen.value = false
}

/** ============== entry list ============== */
const entryDragId = ref<string | null>(null)
const entryDragOverIdx = ref<number | null>(null)
const titleInputRef = ref<HTMLInputElement | null>(null)

function onEntryDragStart(id: string, evt: DragEvent) {
  entryDragId.value = id
  if (evt.dataTransfer) {
    evt.dataTransfer.effectAllowed = 'move'
    evt.dataTransfer.setData('text/plain', id)
  }
}
function onEntryDragOver(idx: number, evt: DragEvent) {
  if (!entryDragId.value) return
  evt.preventDefault()
  if (evt.dataTransfer) evt.dataTransfer.dropEffect = 'move'
  entryDragOverIdx.value = idx
}
function onEntryDrop(idx: number) {
  if (!entryDragId.value) return
  store.reorderEntry(entryDragId.value, idx)
  entryDragId.value = null
  entryDragOverIdx.value = null
}
function onEntryDragEnd() {
  entryDragId.value = null
  entryDragOverIdx.value = null
}

function createEntry() {
  const gid = activeGroupId.value
  if (!gid) return
  store.createEntry(gid)
  void nextTick(() => titleInputRef.value?.focus())
}

const entryDeleteOpen = ref(false)
function confirmDeleteEntry() {
  if (!selectedEntry.value) return
  entryDeleteOpen.value = true
}
function performDeleteEntry() {
  if (!selectedEntry.value) return
  store.deleteEntry(selectedEntry.value.id)
  entryDeleteOpen.value = false
}

/** 关键字输入草稿：失焦/Enter 再解析，避免输入逗号时被立即 split 掉 */
const keysInputDraft = ref('')

function syncKeysDraftFromEntry(): void {
  const e = selectedEntry.value
  keysInputDraft.value = e ? formatLorebookKeysInput(e.keys) : ''
}

function commitKeysForEntry(entryId: string, raw: string): void {
  const e = activeLorebook.value.entries.find((x) => x.id === entryId)
  if (!e || entryKeysInputDisabled(e)) return
  const parsed = parseLorebookKeysInput(raw)
  const same =
    parsed.length === e.keys.length &&
    parsed.every((k, i) => k === e.keys[i])
  if (same) return
  store.updateEntry(entryId, { keys: parsed })
}

function commitKeysDraft(): void {
  const e = selectedEntry.value
  if (!e) return
  commitKeysForEntry(e.id, keysInputDraft.value)
}

watch(selectedEntryId, (id, prevId) => {
  if (prevId != null && prevId !== id) {
    commitKeysForEntry(prevId, keysInputDraft.value)
  }
  syncKeysDraftFromEntry()
}, { immediate: true })

function onKeysInputKeydown(e: KeyboardEvent): void {
  if (e.key !== 'Enter') return
  e.preventDefault()
  commitKeysDraft()
  ;(e.target as HTMLInputElement)?.blur()
}

function previewBody(content: string, max = 120): string {
  const t = content.trim().replace(/\s+/g, ' ')
  if (!t) return ''
  return t.length > max ? `${t.slice(0, max)}…` : t
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function entryMetaLine(e: {
  constant: boolean
  triggerMode?: LorebookTriggerMode
  keys: string[]
}): string {
  const mode = resolveEntryTriggerMode(e)
  if (mode === 'constant') return t('lorebooks.constant')
  if (mode === 'vector') return t('lorebooks.triggerVector')
  if (lorebookEntryMissingKeywords(e)) return t('lorebooks.entryMissingKeys')
  if (e.keys.length) return e.keys.join(' · ')
  return '—'
}

function setEntryTriggerMode(entryId: string, mode: LorebookTriggerMode) {
  store.updateEntry(entryId, patchForTriggerMode(mode))
}
</script>

<template>
  <div
    class="prompts-view flex-grow-1 d-flex flex-column min-height-0"
    :class="{ 'prompts-view--embedded': embedded }"
  >
    <div
      class="prompts-view__inner"
      :class="embedded ? 'prompts-view__inner--embedded' : 'app-page-shell'"
    >
      <header class="library-page-head">
        <div class="library-page-head__row">
          <h1 class="library-page-head__title">
            {{ $t('lorebooks.pageTitle') }}
          </h1>
          <div class="library-page-head__aside">
            <p class="library-page-head__lede">
              {{ $t('lorebooks.lede') }}
            </p>
            <p class="library-page-head__count">
              {{ $t('lorebooks.count', { n: activeLorebook.entries.length }) }}
            </p>
          </div>
        </div>
      </header>

      <v-alert
        v-if="lastError"
        type="error"
        density="compact"
        variant="tonal"
        class="mb-0"
      >
        {{ lastError }}
      </v-alert>

      <div class="preset-bar">
        <div class="preset-bar__left">
          <span class="preset-bar__label">{{ $t('lorebooks.bookLabel') }}</span>
          <v-menu v-model="lorebookSwitchOpen" location="bottom start">
            <template #activator="{ props: act }">
              <button
                type="button"
                class="preset-bar__current"
                v-bind="act"
                :disabled="loading"
              >
                <span class="preset-bar__current-name">{{ activeLorebook.name }}</span>
                <v-icon size="14" class="preset-bar__caret">mdi-chevron-down</v-icon>
              </button>
            </template>
            <v-list density="compact" min-width="200">
              <v-list-item
                v-for="lb in lorebooks"
                :key="lb.id"
                :title="lb.name"
                :active="lb.id === activeLorebookId"
                @click="switchLorebook(lb.id)"
              />
            </v-list>
          </v-menu>
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('lorebooks.bookNew')"
            @click="openCreateLorebook"
          >
            <v-icon size="16">mdi-plus</v-icon>
          </button>
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('lorebooks.bookDuplicate')"
            @click="store.duplicateLorebook(activeLorebookId)"
          >
            <v-icon size="16">mdi-content-duplicate</v-icon>
          </button>
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('lorebooks.bookRename')"
            @click="openRenameLorebook"
          >
            <v-icon size="16">mdi-pencil-outline</v-icon>
          </button>
          <button
            type="button"
            class="preset-bar__icon-btn preset-bar__icon-btn--danger"
            :title="lorebooks.length <= 1
              ? $t('lorebooks.bookCannotDeleteLast')
              : $t('lorebooks.bookDelete')"
            :disabled="lorebooks.length <= 1"
            @click="openDeleteLorebook"
          >
            <v-icon size="16">mdi-trash-can-outline</v-icon>
          </button>
        </div>
        <div class="preset-bar__right">
          <span
            v-if="saving"
            class="text-caption text-medium-emphasis"
          >{{ $t('lorebooks.saving') }}</span>
        </div>
      </div>

      <div
        class="groups-bar"
        role="tablist"
        :aria-label="$t('lorebooks.groupBarLabel')"
      >
        <template v-for="(g, idx) in activeGroups" :key="g.id">
          <span
            v-if="groupDragOverIdx === idx"
            class="groups-bar__drop-indicator"
          />
          <div
            role="tab"
            :aria-selected="activeGroupId === g.id"
            class="group-chip"
            :class="{
              'is-active': activeGroupId === g.id,
              'is-dragging': groupDragId === g.id,
            }"
            draggable="true"
            @click="store.selectGroup(g.id)"
            @dblclick="openRenameGroup(g)"
            @dragstart="onGroupDragStart(g.id, $event)"
            @dragover="onGroupDragOver(idx, $event)"
            @drop="onGroupDrop(idx)"
            @dragend="onGroupDragEnd"
          >
            <v-icon size="13" class="group-chip__icon">mdi-book-open-page-variant</v-icon>
            <span class="group-chip__name">{{ g.name }}</span>
            <span class="group-chip__count">{{ groupCounts[g.id] ?? 0 }}</span>
            <button
              type="button"
              class="group-chip__edit"
              @click.stop="openRenameGroup(g)"
            >
              <v-icon size="11">mdi-pencil-outline</v-icon>
            </button>
            <button
              type="button"
              class="group-chip__close"
              @click.stop="openDeleteGroup(g)"
            >×</button>
          </div>
        </template>
        <span
          v-if="groupDragOverIdx === activeGroups.length"
          class="groups-bar__drop-indicator"
        />
        <button
          type="button"
          class="group-chip group-chip--add"
          @click="openAddGroup"
          @dragover="onGroupDragOver(activeGroups.length, $event)"
          @drop="onGroupDrop(activeGroups.length)"
        >
          <v-icon size="14">mdi-plus</v-icon>
          <span>{{ $t('lorebooks.groupAdd') }}</span>
        </button>
      </div>

      <div class="prompts-layout">
        <aside class="prompts-list">
          <div class="prompts-search">
            <svg
              class="prompts-search__icon"
              viewBox="0 0 16 16"
              fill="none"
              aria-hidden="true"
            >
              <circle cx="7" cy="7" r="4.5" stroke="currentColor" stroke-width="1.3" />
              <path d="M10.5 10.5 L13.5 13.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            </svg>
            <input
              :value="searchText"
              type="text"
              class="prompts-search__input"
              :placeholder="$t('lorebooks.searchPlaceholder')"
              @input="store.setSearchText(($event.target as HTMLInputElement).value)"
            />
            <button
              v-if="searchText"
              type="button"
              class="prompts-search__clear"
              @click="store.setSearchText('')"
            >×</button>
          </div>

          <div class="prompts-list__scroll">
            <button
              v-if="activeGroupId"
              type="button"
              class="entry-card entry-card--new"
              @click="createEntry"
            >
              <span class="entry-card--new__plus">+</span>
              <span class="entry-card--new__label">{{ $t('lorebooks.entryNew') }}</span>
            </button>

            <template v-for="(e, idx) in visibleEntries" :key="e.id">
              <span
                v-if="entryDragOverIdx === idx"
                class="entry-drop-indicator"
              />
              <article
                class="entry-card"
                :class="{
                  'is-active': selectedEntryId === e.id,
                  'is-disabled': !e.enabled,
                  'is-dragging': entryDragId === e.id,
                }"
                tabindex="0"
                draggable="true"
                @click="store.selectEntry(e.id)"
                @dragstart="onEntryDragStart(e.id, $event)"
                @dragover="onEntryDragOver(idx, $event)"
                @drop="onEntryDrop(idx)"
                @dragend="onEntryDragEnd"
              >
                <div class="entry-card__row">
                  <v-icon
                    size="14"
                    class="entry-card__handle"
                    :title="$t('prompts.dragHandle')"
                  >
                    mdi-drag-vertical
                  </v-icon>
                  <button
                    type="button"
                    class="entry-card__enabled"
                    :class="{ 'is-on': e.enabled }"
                    @click.stop="store.updateEntry(e.id, { enabled: !e.enabled })"
                  >
                    <span class="entry-card__enabled-dot" />
                  </button>
                  <h2 class="entry-card__title">
                    {{ e.title || $t('lorebooks.untitled') }}
                  </h2>
                </div>
                <p
                  v-if="e.content"
                  class="entry-card__body"
                >{{ previewBody(e.content) }}</p>
                <div class="entry-card__meta">
                  <span
                    class="entry-card__pos"
                    :class="{
                      'is-chat': e.constant,
                      'is-warn': lorebookEntryMissingKeywords(e),
                    }"
                  >{{ entryMetaLine(e) }}</span>
                  <span class="entry-card__trigs">{{ $t('lorebooks.priority') }} {{ e.priority }}</span>
                </div>
              </article>
            </template>
            <span
              v-if="entryDragOverIdx === visibleEntries.length"
              class="entry-drop-indicator"
            />

            <div
              v-if="activeGroupId && visibleEntries.length === 0"
              class="prompts-empty"
            >
              <div class="prompts-empty__title">{{ $t('lorebooks.emptyTitle') }}</div>
              <div class="prompts-empty__hint">{{ $t('lorebooks.emptyHint') }}</div>
            </div>
          </div>
        </aside>

        <section class="prompts-editor">
          <template v-if="selectedEntry">
            <div class="editor-card">
              <header class="editor-card__head">
                <div class="editor-card__head-row">
                  <button
                    type="button"
                    class="editor-card__enabled"
                    :class="{ 'is-on': selectedEntry.enabled }"
                    @click="store.updateEntry(selectedEntry.id, { enabled: !selectedEntry.enabled })"
                  >
                    <span class="editor-card__enabled-track" />
                    <span class="editor-card__enabled-thumb" />
                  </button>
                  <input
                    ref="titleInputRef"
                    :value="selectedEntry.title"
                    type="text"
                    class="editor-card__title-input"
                    :placeholder="$t('lorebooks.entryTitlePlaceholder')"
                    @input="store.updateEntry(selectedEntry.id, { title: ($event.target as HTMLInputElement).value })"
                  />
                </div>
                <input
                  :value="selectedEntry.comment ?? ''"
                  type="text"
                  class="editor-card__description-input"
                  :placeholder="$t('lorebooks.entryCommentPlaceholder')"
                  @input="store.updateEntry(selectedEntry.id, { comment: ($event.target as HTMLInputElement).value })"
                />
                <div class="editor-card__meta">
                  <span>
                    <span class="editor-card__meta-label">{{ $t('lorebooks.fieldGroup') }}</span>
                    {{ currentGroup?.name ?? '—' }}
                  </span>
                  <span>
                    <span class="editor-card__meta-label">{{ $t('lorebooks.fieldUpdatedAt') }}</span>
                    {{ formatDate(selectedEntry.updatedAt) }}
                  </span>
                </div>
              </header>

              <div class="editor-card__field-row">
                <div class="editor-card__field-block editor-card__field-block--wide">
                  <label class="editor-card__field-label">{{ $t('lorebooks.triggerMode') }}</label>
                  <div class="pill-group">
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': resolveEntryTriggerMode(selectedEntry) === 'keyword' }"
                      @click="setEntryTriggerMode(selectedEntry.id, 'keyword')"
                    >{{ $t('lorebooks.triggerKeyword') }}</button>
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': resolveEntryTriggerMode(selectedEntry) === 'constant' }"
                      @click="setEntryTriggerMode(selectedEntry.id, 'constant')"
                    >{{ $t('lorebooks.constant') }}</button>
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': resolveEntryTriggerMode(selectedEntry) === 'vector' }"
                      @click="setEntryTriggerMode(selectedEntry.id, 'vector')"
                    >{{ $t('lorebooks.triggerVector') }}</button>
                  </div>
                  <p
                    v-if="resolveEntryTriggerMode(selectedEntry) === 'vector'"
                    class="text-caption text-medium-emphasis mt-1 mb-0"
                  >
                    {{ $t('lorebooks.triggerVectorHint') }}
                  </p>
                </div>
                <div class="editor-card__field-block">
                  <label class="editor-card__field-label">{{ $t('lorebooks.priority') }}</label>
                  <span class="num-field">
                    <input
                      :value="selectedEntry.priority"
                      type="number"
                      class="num-field__input"
                      @input="store.updateEntry(selectedEntry.id, { priority: Number(($event.target as HTMLInputElement).value) || 0 })"
                    />
                  </span>
                </div>
              </div>

              <v-alert
                v-if="lorebookEntryMissingKeywords(selectedEntry)"
                type="warning"
                density="compact"
                variant="tonal"
                class="editor-card__keys-warn mb-0"
              >
                {{ $t('lorebooks.entryMissingKeysAlert') }}
              </v-alert>

              <div class="editor-card__field">
                <label class="editor-card__field-label">
                  {{ $t('lorebooks.entryKeys') }}
                  <span class="editor-card__field-hint">{{ $t('lorebooks.entryKeysHint') }}</span>
                </label>
                <input
                  v-model="keysInputDraft"
                  type="text"
                  class="editor-card__tags-input"
                  :class="{ 'editor-card__tags-input--warn': lorebookEntryMissingKeywords(selectedEntry) }"
                  :disabled="entryKeysInputDisabled(selectedEntry)"
                  :placeholder="$t('lorebooks.entryKeysPlaceholder')"
                  @blur="commitKeysDraft"
                  @keydown="onKeysInputKeydown"
                />
              </div>

              <div class="editor-card__field">
                <label class="editor-card__field-label">
                  {{ $t('lorebooks.entryContent') }}
                </label>
                <textarea
                  :value="selectedEntry.content"
                  class="editor-card__content-input"
                  rows="12"
                  spellcheck="false"
                  :placeholder="$t('lorebooks.entryContentPlaceholder')"
                  @input="store.updateEntry(selectedEntry.id, { content: ($event.target as HTMLTextAreaElement).value })"
                />
              </div>

              <footer class="editor-card__foot">
                <span class="editor-card__autosave">{{ $t('lorebooks.autosaveHint') }}</span>
                <span class="editor-card__actions">
                  <button
                    type="button"
                    class="editor-card__btn"
                    @click="store.duplicateEntry(selectedEntry.id)"
                  >{{ $t('lorebooks.duplicate') }}</button>
                  <button
                    type="button"
                    class="editor-card__btn editor-card__btn--danger"
                    @click="confirmDeleteEntry"
                  >{{ $t('lorebooks.entryDelete') }}</button>
                </span>
              </footer>
            </div>
          </template>
          <template v-else>
            <div class="editor-empty">
              <v-icon size="44" class="editor-empty__icon">mdi-book-open-page-variant</v-icon>
              <h2 class="editor-empty__title">{{ $t('lorebooks.editorEmptyTitle') }}</h2>
              <p class="editor-empty__hint">{{ $t('lorebooks.editorEmptyHint') }}</p>
              <button
                v-if="activeGroupId"
                type="button"
                class="editor-empty__cta"
                @click="createEntry"
              >+ {{ $t('lorebooks.entryNew') }}</button>
            </div>
          </template>
        </section>
      </div>
    </div>

    <v-dialog v-model="lorebookCreateOpen" max-width="24rem">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('lorebooks.bookNewDialog') }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="lorebookCreateName"
            :label="$t('lorebooks.bookName')"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            autofocus
            @keydown.enter.prevent="submitCreateLorebook"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="lorebookCreateOpen = false">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!lorebookCreateName.trim()" @click="submitCreateLorebook">
            {{ $t('settings.themeConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="lorebookRenameOpen" max-width="24rem">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('lorebooks.bookRenameDialog') }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="lorebookRenameDraft"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            autofocus
            @keydown.enter.prevent="submitRenameLorebook"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="lorebookRenameOpen = false">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="primary" variant="flat" @click="submitRenameLorebook">{{ $t('settings.themeConfirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="lorebookDeleteOpen" max-width="24rem">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('lorebooks.bookDeleteDialog') }}</v-card-title>
        <v-card-text>{{ $t('lorebooks.bookDeleteBody', { name: activeLorebook.name }) }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="lorebookDeleteOpen = false">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="error" variant="flat" @click="performDeleteLorebook">{{ $t('settings.themeConfirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="groupAddOpen" max-width="24rem">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('lorebooks.groupAddDialog') }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="groupAddName"
            :label="$t('lorebooks.groupName')"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            autofocus
            @keydown.enter.prevent="submitAddGroup"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="groupAddOpen = false">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!groupAddName.trim()" @click="submitAddGroup">
            {{ $t('settings.themeConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="groupRenameOpen" max-width="24rem">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('lorebooks.groupRenameDialog') }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="groupRenameDraft"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            autofocus
            @keydown.enter.prevent="submitRenameGroup"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="groupRenameOpen = false">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="primary" variant="flat" @click="submitRenameGroup">{{ $t('settings.themeConfirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="groupDeleteOpen" max-width="24rem">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('lorebooks.groupDeleteDialog') }}</v-card-title>
        <v-card-text>{{ $t('lorebooks.groupDeleteBody', { name: groupDeleteTarget?.name ?? '' }) }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="groupDeleteOpen = false">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="error" variant="flat" @click="performDeleteGroup">{{ $t('settings.themeConfirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="entryDeleteOpen" max-width="24rem">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('lorebooks.entryDeleteDialog') }}</v-card-title>
        <v-card-text>{{ $t('lorebooks.entryDeleteBody', { title: selectedEntry?.title || $t('lorebooks.untitled') }) }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="entryDeleteOpen = false">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="error" variant="flat" @click="performDeleteEntry">{{ $t('settings.themeConfirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Shared layout with PromptsView — see @/styles/prompts-library.css */
</style>
