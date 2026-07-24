<script setup lang="ts">
import EntryBatchTargetDialog from '@/components/EntryBatchTargetDialog.vue'
import GroupTargetPickerDialog from '@/components/GroupTargetPickerDialog.vue'
import { useLorebooksStore } from '@/stores/lorebooks'
import { lorebookGroupPickerItems } from '@/utils/entry-group-transfer'
import { mergeSelectAllVisible } from '@/utils/entry-batch-transfer'
import type { BatchTransferTarget } from '@/utils/entry-batch-transfer'
import { coreNotify } from '@/utils/core-notify'
import type { LorebookGroup } from '@/stores/lorebooks'
import {
  entryKeysInputDisabled,
  formatLorebookKeysInput,
  lorebookEntryMissingKeywords,
  parseLorebookKeysInput,
  patchForTriggerMode,
  resolveEntryPosition,
  resolveEntryTriggerMode,
  type LorebookEntryPosition,
  type LorebookTriggerMode,
} from '@/utils/lorebook-entry'
import { parseLorebookImport } from '@/utils/lorebooks-package'
import { useNarrowLayout } from '@/composables/use-narrow-layout'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{ embedded?: boolean }>(),
  { embedded: false },
)

const emit = defineEmits<{
  close: []
}>()

const { t } = useI18n()
const store = useLorebooksStore()

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
  multiSelectMode,
  selectedEntryIds,
} = storeToRefs(store)

const { isNarrow } = useNarrowLayout()
const mobileMasterDetail = computed(() => props.embedded && isNarrow.value)
const showEditorPane = computed(
  () =>
    !multiSelectMode.value &&
    (!mobileMasterDetail.value || Boolean(selectedEntryId.value)),
)

function backToEntryList() {
  selectedEntryId.value = null
}

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
  if (multiSelectMode.value) {
    evt.preventDefault()
    return
  }
  entryDragId.value = id
  if (evt.dataTransfer) {
    evt.dataTransfer.effectAllowed = 'move'
    evt.dataTransfer.setData('text/plain', id)
  }
}

function onEntryCardClick(entryId: string) {
  if (multiSelectMode.value) {
    store.toggleEntryMultiSelected(entryId)
    return
  }
  store.selectEntry(entryId)
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

const groupTransferOpen = ref(false)
const groupTransferMode = ref<'copy' | 'move'>('copy')
const groupPickerItems = computed(() =>
  lorebookGroupPickerItems(activeGroups.value, groupCounts.value),
)

function duplicateCurrentEntry() {
  if (!selectedEntry.value) return
  store.duplicateEntry(selectedEntry.value.id)
}

function openGroupTransfer(mode: 'copy' | 'move') {
  if (!selectedEntry.value) return
  groupTransferMode.value = mode
  groupTransferOpen.value = true
}

function onGroupTransferPick(targetGroupId: string) {
  if (!selectedEntry.value) return
  if (groupTransferMode.value === 'copy') {
    store.duplicateEntry(selectedEntry.value.id, targetGroupId)
  } else {
    store.moveEntryToGroup(selectedEntry.value.id, targetGroupId)
  }
}

const batchTransferOpen = ref(false)
const batchTransferMode = ref<'copy' | 'move'>('copy')

const batchLibraries = computed(() =>
  lorebooks.value.map((lb) => ({ id: lb.id, name: lb.name })),
)

const batchCurrentGroupId = computed(() => {
  const ids = selectedEntryIds.value
  if (ids.length === 0) return activeGroupId.value
  const gids = new Set(
    activeLorebook.value.entries
      .filter((e) => ids.includes(e.id))
      .map((e) => e.groupId),
  )
  return gids.size === 1 ? [...gids][0]! : null
})

function openBatchTransfer(mode: 'copy' | 'move') {
  if (selectedEntryIds.value.length === 0) return
  batchTransferMode.value = mode
  batchTransferOpen.value = true
}

function selectAllVisibleEntries() {
  store.setSelectedEntryIds(
    mergeSelectAllVisible(
      selectedEntryIds.value,
      visibleEntries.value.map((e) => e.id),
    ),
  )
}

function onBatchTransferPick(target: BatchTransferTarget) {
  const ids = selectedEntryIds.value.slice()
  const result =
    batchTransferMode.value === 'copy'
      ? store.batchDuplicateEntries(ids, target.libraryId, target.groupId)
      : store.batchMoveEntries(ids, target.libraryId, target.groupId)
  if (!result.ok) {
    const key =
      result.reason === 'empty'
        ? 'entryTransfer.batchNothingToTransfer'
        : 'entryTransfer.batchTargetMissing'
    coreNotify(t(key), undefined, { level: 'warning', snackbar: true })
    return
  }
  coreNotify(
    t(
      batchTransferMode.value === 'copy'
        ? 'entryTransfer.batchOkCopy'
        : 'entryTransfer.batchOkMove',
      { n: result.count },
    ),
    undefined,
    { level: 'success', snackbar: true },
  )
}

const entryDeleteOpen = ref(false)

function onMultiSelectKeydown(evt: KeyboardEvent) {
  if (evt.key !== 'Escape' || !multiSelectMode.value) return
  if (
    batchTransferOpen.value ||
    groupTransferOpen.value ||
    entryDeleteOpen.value
  ) {
    return
  }
  store.exitMultiSelect()
}

onMounted(() => {
  void store.loadFromServer()
  window.addEventListener('keydown', onMultiSelectKeydown)
})

function confirmDeleteEntry() {
  if (!selectedEntry.value) return
  entryDeleteOpen.value = true
}
function performDeleteEntry() {
  if (!selectedEntry.value) return
  store.deleteEntry(selectedEntry.value.id)
  entryDeleteOpen.value = false
}

/** 文本字段草稿：失焦或切换条目时再写回 store 并保存 */
const titleDraft = ref('')
const commentDraft = ref('')
const contentDraft = ref('')
const priorityDraft = ref(0)
const orderDraft = ref(0)

function syncEntryEditorDraftsFromEntry(): void {
  const e = selectedEntry.value
  if (!e) {
    titleDraft.value = ''
    commentDraft.value = ''
    contentDraft.value = ''
    priorityDraft.value = 0
    orderDraft.value = 0
    return
  }
  titleDraft.value = e.title
  commentDraft.value = e.comment ?? ''
  contentDraft.value = e.content
  priorityDraft.value = e.priority
  orderDraft.value = e.order
}

function commitEntryEditorDrafts(entryId?: string): void {
  const id = entryId ?? selectedEntry.value?.id
  if (!id) return
  const e = activeLorebook.value.entries.find((x) => x.id === id)
  if (!e) return

  const patch: {
    title?: string
    comment?: string
    content?: string
    priority?: number
    order?: number
  } = {}

  if (titleDraft.value !== e.title) patch.title = titleDraft.value
  if (commentDraft.value !== (e.comment ?? '')) {
    patch.comment = commentDraft.value
  }
  if (contentDraft.value !== e.content) patch.content = contentDraft.value

  const pri = Number(priorityDraft.value)
  const normalizedPri = Number.isFinite(pri) ? pri : 0
  if (normalizedPri !== e.priority) patch.priority = normalizedPri

  const ord = Number(orderDraft.value)
  const normalizedOrd = Number.isFinite(ord) ? ord : 0
  if (normalizedOrd !== e.order) patch.order = normalizedOrd

  if (Object.keys(patch).length > 0) {
    store.updateEntry(id, patch)
  }
}

function commitAllDraftsForEntry(entryId: string): void {
  commitKeysForEntry(entryId, keysInputDraft.value)
  commitEntryEditorDrafts(entryId)
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
    commitAllDraftsForEntry(prevId)
  }
  syncKeysDraftFromEntry()
  syncEntryEditorDraftsFromEntry()
}, { immediate: true })

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onMultiSelectKeydown)
  const id = selectedEntryId.value
  if (id) commitAllDraftsForEntry(id)
})

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
  position?: LorebookEntryPosition
  keys: string[]
}): string {
  const mode = resolveEntryTriggerMode(e)
  const pos =
    resolveEntryPosition(e) === 'before_char'
      ? t('lorebooks.positionBeforeChar')
      : t('lorebooks.positionAfterChar')
  if (mode === 'constant') return `${t('lorebooks.constant')} · ${pos}`
  if (mode === 'vector') return `${t('lorebooks.triggerVector')} · ${pos}`
  if (lorebookEntryMissingKeywords(e)) return t('lorebooks.entryMissingKeys')
  if (e.keys.length) return `${e.keys.join(' · ')} · ${pos}`
  return pos
}

function setEntryTriggerMode(entryId: string, mode: LorebookTriggerMode) {
  store.updateEntry(entryId, patchForTriggerMode(mode))
}

function setEntryPosition(entryId: string, position: LorebookEntryPosition) {
  store.updateEntry(entryId, { position })
}

/** ============== 当前资料库导入 / 导出 ============== */
const importFileRef = ref<HTMLInputElement | null>(null)
const importErrorOpen = ref(false)
const importErrorMsg = ref('')
const importConfirmOpen = ref(false)
const importPendingText = ref('')
const importPreviewName = ref('')
const importDoing = ref(false)

function performExportActiveLorebook() {
  store.exportActiveLorebook()
}

function performImportPickFile() {
  importFileRef.value?.click()
}

async function onImportFileChange(evt: Event) {
  const input = evt.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    const lb = parseLorebookImport(JSON.parse(text))
    importPendingText.value = text
    importPreviewName.value = lb.name.trim() || lb.id
    importConfirmOpen.value = true
  } catch (e) {
    importErrorMsg.value = e instanceof Error ? e.message : String(e)
    importErrorOpen.value = true
  }
}

async function confirmImportLorebook() {
  importDoing.value = true
  try {
    await store.importLorebookFromJson(importPendingText.value)
    importConfirmOpen.value = false
    importPendingText.value = ''
  } catch (e) {
    importErrorMsg.value = e instanceof Error ? e.message : String(e)
    importErrorOpen.value = true
  } finally {
    importDoing.value = false
  }
}
</script>

<template>
  <div
    class="prompts-view flex-grow-1 d-flex flex-column min-height-0"
    :class="{
      'prompts-view--embedded': props.embedded,
      'prompts-view--master-detail': mobileMasterDetail,
    }"
  >
    <div
      class="prompts-view__inner"
      :class="props.embedded ? 'prompts-view__inner--embedded' : 'app-page-shell'"
    >
      <header
        class="library-page-head"
        :class="{ 'library-page-head--with-close': props.embedded }"
      >
        <div class="library-page-head__row">
          <h1 class="library-page-head__title">
            {{ $t('lorebooks.pageTitle') }}
          </h1>
          <div class="library-page-head__aside">
            <p class="library-page-head__lede">
              {{ $t('lorebooks.lede') }}
            </p>
          </div>
          <button
            v-if="props.embedded"
            type="button"
            class="library-page-head__close"
            :aria-label="$t('settings.closeModal')"
            @click="emit('close')"
          >
            <v-icon size="20">mdi-close</v-icon>
          </button>
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
                <v-tooltip
                  location="top start"
                  :text="activeLorebook.name"
                >
                  <template #activator="{ props: tipProps }">
                    <span
                      v-bind="tipProps"
                      class="preset-bar__current-name"
                    >{{ activeLorebook.name }}</span>
                  </template>
                </v-tooltip>
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
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('lorebooks.packageImport')"
            :aria-label="$t('lorebooks.packageImport')"
            :disabled="loading || importDoing"
            @click="performImportPickFile"
          >
            <v-icon size="16">mdi-tray-arrow-down</v-icon>
          </button>
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('lorebooks.packageExport')"
            :aria-label="$t('lorebooks.packageExport')"
            :disabled="loading"
            @click="performExportActiveLorebook"
          >
            <v-icon size="16">mdi-tray-arrow-up</v-icon>
          </button>
          <input
            ref="importFileRef"
            type="file"
            accept="application/json,.json"
            style="display: none"
            @change="onImportFileChange"
          />
        </div>
        <div class="preset-bar__right">
          <p class="preset-bar__count">
            {{ $t('lorebooks.count', { n: activeLorebook.entries.length }) }}
          </p>
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
            <div class="prompts-search__field">
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
            <button
              v-if="!multiSelectMode"
              type="button"
              class="prompts-search__multi"
              @click="store.enterMultiSelect()"
            >{{ $t('entryTransfer.multiSelect') }}</button>
            <button
              v-else
              type="button"
              class="prompts-search__multi is-active"
              @click="store.exitMultiSelect()"
            >{{ $t('entryTransfer.multiSelectDone') }}</button>
          </div>

          <div
            v-if="multiSelectMode"
            class="entry-batch-bar"
          >
            <span class="entry-batch-bar__count">
              {{ $t('entryTransfer.batchSelected', { n: selectedEntryIds.length }) }}
            </span>
            <button
              type="button"
              class="entry-batch-bar__btn"
              @click="selectAllVisibleEntries"
            >{{ $t('entryTransfer.batchSelectAllVisible') }}</button>
            <button
              type="button"
              class="entry-batch-bar__btn"
              :disabled="selectedEntryIds.length === 0"
              @click="store.clearMultiSelection()"
            >{{ $t('entryTransfer.batchClearSelection') }}</button>
            <v-spacer />
            <button
              type="button"
              class="entry-batch-bar__btn entry-batch-bar__btn--primary"
              :disabled="selectedEntryIds.length === 0"
              @click="openBatchTransfer('copy')"
            >{{ $t('entryTransfer.batchCopyTo') }}</button>
            <button
              type="button"
              class="entry-batch-bar__btn entry-batch-bar__btn--primary"
              :disabled="selectedEntryIds.length === 0"
              @click="openBatchTransfer('move')"
            >{{ $t('entryTransfer.batchMoveTo') }}</button>
          </div>

          <div class="prompts-list__scroll">
            <button
              v-if="activeGroupId && !multiSelectMode"
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
                  'is-active': !multiSelectMode && selectedEntryId === e.id,
                  'is-selected': multiSelectMode && selectedEntryIds.includes(e.id),
                  'is-disabled': !e.enabled,
                  'is-dragging': entryDragId === e.id,
                }"
                tabindex="0"
                :draggable="!multiSelectMode"
                @click="onEntryCardClick(e.id)"
                @dragstart="onEntryDragStart(e.id, $event)"
                @dragover="onEntryDragOver(idx, $event)"
                @drop="onEntryDrop(idx)"
                @dragend="onEntryDragEnd"
              >
                <div class="entry-card__row">
                  <v-checkbox
                    v-if="multiSelectMode"
                    :model-value="selectedEntryIds.includes(e.id)"
                    density="compact"
                    hide-details
                    class="entry-card__check"
                    @click.stop
                    @update:model-value="store.toggleEntryMultiSelected(e.id)"
                  />
                  <v-icon
                    v-else
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
                  ></button>
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
                  <span class="entry-card__trigs">{{ $t('lorebooks.order') }} {{ e.order }} · {{ $t('lorebooks.priority') }} {{ e.priority }}</span>
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

        <section v-if="showEditorPane" class="prompts-editor">
          <div class="prompts-editor__panel">
          <button
            v-if="mobileMasterDetail"
            type="button"
            class="prompts-editor__back"
            @click="backToEntryList"
          >
            <v-icon size="18">mdi-chevron-left</v-icon>
            {{ $t('lorebooks.backToList') }}
          </button>
          <div class="prompts-editor__scroll">
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
                    v-model="titleDraft"
                    type="text"
                    class="editor-card__title-input"
                    :placeholder="$t('lorebooks.entryTitlePlaceholder')"
                    @blur="commitEntryEditorDrafts()"
                  />
                </div>
                <input
                  v-model="commentDraft"
                  type="text"
                  class="editor-card__description-input"
                  :placeholder="$t('lorebooks.entryCommentPlaceholder')"
                  @blur="commitEntryEditorDrafts()"
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

              <div class="editor-card__field-row editor-card__field-row--trigger-pos">
                <div class="editor-card__field-block">
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
                  <label class="editor-card__field-label">
                    {{ $t('lorebooks.position') }}
                  </label>
                  <div class="pill-group">
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': resolveEntryPosition(selectedEntry) === 'before_char' }"
                      @click="setEntryPosition(selectedEntry.id, 'before_char')"
                    >{{ $t('lorebooks.positionBeforeChar') }}</button>
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': resolveEntryPosition(selectedEntry) === 'after_char' }"
                      @click="setEntryPosition(selectedEntry.id, 'after_char')"
                    >{{ $t('lorebooks.positionAfterChar') }}</button>
                  </div>
                  <p class="text-caption text-medium-emphasis mt-1 mb-0">
                    {{ $t('lorebooks.positionHint') }}
                  </p>
                </div>
              </div>

              <div class="editor-card__field-row editor-card__field-row--nums">
                <div class="editor-card__field-block">
                  <label class="editor-card__field-label">
                    {{ $t('lorebooks.order') }}
                    <span class="editor-card__field-hint">{{ $t('lorebooks.orderHint') }}</span>
                  </label>
                  <span class="num-field">
                    <input
                      v-model.number="orderDraft"
                      type="number"
                      class="num-field__input"
                      @blur="commitEntryEditorDrafts()"
                    />
                  </span>
                </div>
                <div class="editor-card__field-block">
                  <label class="editor-card__field-label">
                    {{ $t('lorebooks.priority') }}
                    <span class="editor-card__field-hint">{{ $t('lorebooks.priorityHint') }}</span>
                  </label>
                  <span class="num-field">
                    <input
                      v-model.number="priorityDraft"
                      type="number"
                      class="num-field__input"
                      @blur="commitEntryEditorDrafts()"
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
                  v-model="contentDraft"
                  class="editor-card__content-input"
                  rows="18"
                  spellcheck="false"
                  :placeholder="$t('lorebooks.entryContentPlaceholder')"
                  @blur="commitEntryEditorDrafts()"
                />
              </div>

              <footer class="editor-card__foot">
                <span class="editor-card__autosave">{{ $t('lorebooks.autosaveHint') }}</span>
                <span class="editor-card__actions">
                  <button
                    type="button"
                    class="editor-card__btn"
                    @click="duplicateCurrentEntry"
                  >{{ $t('entryTransfer.copy') }}</button>
                  <button
                    type="button"
                    class="editor-card__btn"
                    @click="openGroupTransfer('copy')"
                  >{{ $t('entryTransfer.copyTo') }}</button>
                  <button
                    type="button"
                    class="editor-card__btn"
                    @click="openGroupTransfer('move')"
                  >{{ $t('entryTransfer.moveTo') }}</button>
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
          </div>
          </div>
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

    <GroupTargetPickerDialog
      v-model:open="groupTransferOpen"
      :mode="groupTransferMode"
      :groups="groupPickerItems"
      :current-group-id="activeGroupId ?? undefined"
      @pick="onGroupTransferPick"
    />

    <EntryBatchTargetDialog
      v-model:open="batchTransferOpen"
      :mode="batchTransferMode"
      :libraries="batchLibraries"
      :current-library-id="activeLorebookId"
      :current-group-id="batchCurrentGroupId"
      :resolve-groups="store.groupsForLorebook"
      @pick="onBatchTransferPick"
    />

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

    <v-dialog v-model="importConfirmOpen" max-width="28rem">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('lorebooks.packageImportConfirmTitle') }}</v-card-title>
        <v-card-text class="text-body-2">
          {{ $t('lorebooks.packageImportConfirmBody', { name: importPreviewName }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" :disabled="importDoing" @click="importConfirmOpen = false">
            {{ $t('settings.themeCancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="importDoing"
            @click="confirmImportLorebook"
          >
            {{ $t('settings.themeConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="importErrorOpen" max-width="28rem">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('lorebooks.packageImportFailed') }}</v-card-title>
        <v-card-text class="text-body-2">{{ importErrorMsg }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="importErrorOpen = false">
            {{ $t('settings.themeConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Shared layout with PromptsView — see @/styles/prompts-library.css */
</style>
