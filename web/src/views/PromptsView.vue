<script setup lang="ts">
import GroupTargetPickerDialog from '@/components/GroupTargetPickerDialog.vue'
import {
  groupAllowsPromptEntries,
  usePromptsStore,
} from '@/stores/prompts'
import { promptGroupPickerItems } from '@/utils/entry-group-transfer'
import type {
  GroupKind,
  PromptEntry,
  PromptGroup,
  PromptRole,
  PromptTrigger,
} from '@/stores/prompts'
import { useConnectionStore } from '@/stores/connection'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

withDefaults(
  defineProps<{
    /** 在 App 模态内展示：放宽宽度并压缩依赖视口高度的区域 */
    embedded?: boolean
  }>(),
  { embedded: false },
)

const store = usePromptsStore()
onMounted(() => {
  void store.loadFromServer()
})
const {
  presets,
  activePresetId,
  activePreset,
  activeGroups,
  activeGroupId,
  searchText,
  selected,
  visiblePrompts,
  groupCounts,
} = storeToRefs(store)

/** ============== preset bar ============== */
const presetSwitchOpen = ref(false)
const presetCreateOpen = ref(false)
const presetCreateName = ref('')
const presetRenameOpen = ref(false)
const presetRenameDraft = ref('')
const presetDeleteOpen = ref(false)

function openCreatePreset() {
  presetCreateName.value = ''
  presetCreateOpen.value = true
}
function submitCreatePreset() {
  if (!presetCreateName.value.trim()) return
  store.createPreset(presetCreateName.value)
  presetCreateOpen.value = false
}
function openRenamePreset() {
  presetRenameDraft.value = activePreset.value.name
  presetRenameOpen.value = true
}
function submitRenamePreset() {
  store.renamePreset(activePresetId.value, presetRenameDraft.value)
  presetRenameOpen.value = false
}
function performDuplicatePreset() {
  store.duplicatePreset(activePresetId.value)
}
function openDeletePreset() {
  if (presets.value.length <= 1) return
  presetDeleteOpen.value = true
}
function performDeletePreset() {
  store.deletePreset(activePresetId.value)
  presetDeleteOpen.value = false
}
function switchPreset(id: string) {
  store.selectPreset(id)
  presetSwitchOpen.value = false
}

/** ============== preset import / export ============== */
const importFileRef = ref<HTMLInputElement | null>(null)
const importErrorOpen = ref(false)
const importErrorMsg = ref('')

function triggerDownload(text: string, filename: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  // 给浏览器一点时间触发下载再回收
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function performExportActive() {
  const { json, filename } = store.exportActivePreset()
  triggerDownload(json, filename)
}

function performImportPickFile() {
  importFileRef.value?.click()
}

async function onImportFileChange(evt: Event) {
  const input = evt.target as HTMLInputElement
  const file = input.files?.[0]
  // 重置 value 以便相同文件可再次触发 change
  input.value = ''
  if (!file) return
  try {
    const text = await file.text()
    store.importPresetsFromJson(text)
  } catch (e) {
    importErrorMsg.value = e instanceof Error ? e.message : String(e)
    importErrorOpen.value = true
  }
}

/** ============== groups bar drag ============== */
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

/** ============== group CRUD ============== */
const groupAddOpen = ref(false)
const groupAddName = ref('')
const groupRenameOpen = ref(false)
const groupRenameDraft = ref('')
const groupRenameTarget = ref<PromptGroup | null>(null)
const groupDeleteOpen = ref(false)
const groupDeleteTarget = ref<PromptGroup | null>(null)

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
function openRenameGroup(g: PromptGroup) {
  groupRenameTarget.value = g
  groupRenameDraft.value = g.name
  groupRenameOpen.value = true
}
function submitRenameGroup() {
  if (!groupRenameTarget.value) return
  store.renameGroup(groupRenameTarget.value.id, groupRenameDraft.value)
  groupRenameOpen.value = false
}
function openDeleteGroup(g: PromptGroup) {
  if (!canDeleteGroup(g)) return
  groupDeleteTarget.value = g
  groupDeleteOpen.value = true
}
function performDeleteGroup() {
  if (!groupDeleteTarget.value) return
  store.deleteGroup(groupDeleteTarget.value.id)
  groupDeleteOpen.value = false
}

function selectGroup(g: PromptGroup) {
  store.selectGroup(g.id)
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
  const targetGroupId = activeGroupId.value
  if (!targetGroupId) return
  store.reorderPrompt(entryDragId.value, targetGroupId, idx)
  entryDragId.value = null
  entryDragOverIdx.value = null
}
function onEntryDragEnd() {
  entryDragId.value = null
  entryDragOverIdx.value = null
}

function selectEntry(id: string) {
  store.selectPrompt(id)
}

function createEntry() {
  const gid = activeGroupId.value
  if (!gid) return
  const g = activeGroups.value.find((x) => x.id === gid)
  if (!g || !groupAllowsPromptEntries(g.kind)) return
  store.createPrompt(gid)
  void nextTick(() => titleInputRef.value?.focus())
}

function duplicateCurrent() {
  if (!selected.value) return
  store.duplicatePrompt(selected.value.id)
}

const groupTransferOpen = ref(false)
const groupTransferMode = ref<'copy' | 'move'>('copy')
const groupPickerItems = computed(() =>
  promptGroupPickerItems(
    activeGroups.value,
    groupCounts.value,
    selected.value,
  ),
)

function openGroupTransfer(mode: 'copy' | 'move') {
  if (!selected.value || selected.value.bindingSlot) return
  groupTransferMode.value = mode
  groupTransferOpen.value = true
}

function onGroupTransferPick(targetGroupId: string) {
  if (!selected.value) return
  if (groupTransferMode.value === 'copy') {
    store.duplicatePrompt(selected.value.id, targetGroupId)
  } else {
    store.movePromptToGroup(selected.value.id, targetGroupId)
  }
}

const entryDeleteOpen = ref(false)
function confirmDeleteEntry() {
  if (!selected.value) return
  entryDeleteOpen.value = true
}
function performDeleteEntry() {
  if (!selected.value) return
  store.deletePrompt(selected.value.id)
  entryDeleteOpen.value = false
}

/** ============== editor field bindings ============== */
const ROLE_OPTIONS: { id: PromptRole; key: string }[] = [
  { id: 'system', key: 'prompts.roleSystem' },
  { id: 'user', key: 'prompts.roleUser' },
  { id: 'assistant', key: 'prompts.roleAssistant' },
]

const TRIGGER_OPTIONS: { id: PromptTrigger; key: string }[] = [
  { id: 'normal', key: 'prompts.triggerNormal' },
  { id: 'continue', key: 'prompts.triggerContinue' },
  { id: 'swipe', key: 'prompts.triggerSwipe' },
  { id: 'regenerate', key: 'prompts.triggerRegenerate' },
]

const tagsInput = computed<string>({
  get: () => (selected.value ? selected.value.tags.join(', ') : ''),
  set: (v) => {
    if (!selected.value) return
    const tags = v
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    store.updatePrompt(selected.value.id, { tags })
  },
})

function onEnabledToggle() {
  if (!selected.value) return
  if (bindingSlotIsRequired(selected.value.bindingSlot)) return
  store.updatePrompt(selected.value.id, { enabled: !selected.value.enabled })
}

function onTitleInput(e: Event) {
  if (!selected.value) return
  store.updatePrompt(selected.value.id, {
    title: (e.target as HTMLInputElement).value,
  })
}
function onDescriptionInput(e: Event) {
  if (!selected.value) return
  store.updatePrompt(selected.value.id, {
    description: (e.target as HTMLInputElement).value,
  })
}
function onContentInput(e: Event) {
  if (!selected.value) return
  store.updatePrompt(selected.value.id, {
    content: (e.target as HTMLTextAreaElement).value,
  })
}
function setRole(r: PromptRole) {
  if (!selected.value) return
  store.updatePrompt(selected.value.id, { role: r })
}
function setPosition(p: 'relative' | 'chat') {
  if (!selected.value) return
  store.updatePrompt(selected.value.id, { injectionPosition: p })
}
function onDepthInput(e: Event) {
  if (!selected.value) return
  const n = Number.parseInt((e.target as HTMLInputElement).value, 10)
  store.updatePrompt(selected.value.id, {
    injectionDepth: Number.isFinite(n) ? Math.max(0, n) : 0,
  })
}
function onOrderInput(e: Event) {
  if (!selected.value) return
  const n = Number.parseInt((e.target as HTMLInputElement).value, 10)
  store.updatePrompt(selected.value.id, {
    injectionOrder: Number.isFinite(n) ? n : 100,
  })
}
function toggleTrigger(tr: PromptTrigger) {
  if (!selected.value) return
  const cur = selected.value.triggers
  const next = cur.includes(tr) ? cur.filter((x) => x !== tr) : [...cur, tr]
  store.updatePrompt(selected.value.id, { triggers: next })
}

/** ============== preview modal ============== */
const previewOpen = ref(false)
const conn = useConnectionStore()
const previewTrigger = ref<PromptTrigger | 'all'>('all')
const previewCopiedFlash = ref(false)
const previewLoading = ref(false)
const previewError = ref('')
const previewResult = ref<{
  messages: { role: string; content: string }[]
  estimatedTokens: number
  droppedHistoryCount: number
} | null>(null)

function openPreview() {
  previewTrigger.value = 'all'
  previewOpen.value = true
}

async function fetchAssemblePreview() {
  if (!previewOpen.value) return
  previewLoading.value = true
  previewError.value = ''
  previewResult.value = null
  const p = activePreset.value
  const useSys = p.prompts.some(
    (e) => e.bindingSlot === 'boundCharacterSystem' && e.enabled,
  )
  const usePost = p.prompts.some(
    (e) => e.bindingSlot === 'boundCharacterPostHistory' && e.enabled,
  )
  try {
    const res = await fetch('/api/prompts/assemble-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presetId: p.id,
        promptTrigger: previewTrigger.value,
        conversationUserName: 'User',
        useBoundCharacterSystem: useSys,
        useBoundCharacterPostHistory: usePost,
        model: conn.model.trim() || undefined,
        contextLength: conn.contextLength ?? undefined,
      }),
    })
    if (!res.ok) {
      let msg = 'Preview failed'
      try {
        const j = (await res.json()) as { error?: string }
        msg = j.error || msg
      } catch {
        /* ignore */
      }
      previewError.value = msg
      return
    }
    previewResult.value = (await res.json()) as {
      messages: { role: string; content: string }[]
      estimatedTokens: number
      droppedHistoryCount: number
    }
  } catch {
    previewError.value = 'Preview failed'
  } finally {
    previewLoading.value = false
  }
}

watch([previewOpen, previewTrigger, () => activePreset.value.id], () => {
  if (previewOpen.value) void fetchAssemblePreview()
})

const previewJson = computed(() => {
  if (!previewResult.value) return ''
  return JSON.stringify(previewResult.value.messages, null, 2)
})

async function copyPreviewJson() {
  if (!previewJson.value) return
  try {
    await navigator.clipboard.writeText(previewJson.value)
    previewCopiedFlash.value = true
    setTimeout(() => (previewCopiedFlash.value = false), 1200)
  } catch {
    /* ignore */
  }
}

/** ============== helpers ============== */
function placeholderDescKey(kind: GroupKind): string {
  switch (kind) {
    case 'character':
      return 'prompts.groupBoundDescCharacter'
    case 'world':
      return 'prompts.groupBoundDescWorld'
    case 'history':
      return 'prompts.groupBoundDescHistory'
    case 'userInput':
      return 'prompts.groupBoundDescUserInput'
    default:
      return ''
  }
}

function bindingSlotLabelKey(slot: string | undefined): string {
  switch (slot) {
    case 'boundCharacterSystem':
      return 'prompts.boundCharacterSystemLabel'
    case 'boundWorld':
      return 'prompts.boundWorldLabel'
    case 'boundCharacterPostHistory':
      return 'prompts.boundCharacterPostHistoryLabel'
    case 'boundUserInput':
      return 'prompts.boundUserInputLabel'
    default:
      return 'prompts.untitled'
  }
}

function bindingSlotIsRequired(slot: string | undefined): boolean {
  return slot === 'boundWorld' || slot === 'boundUserInput'
}

function bindingSlotListHintKey(slot: string | undefined): string {
  switch (slot) {
    case 'boundCharacterSystem':
      return 'prompts.boundCharacterListHintSystem'
    case 'boundWorld':
      return 'prompts.boundWorldListHint'
    case 'boundCharacterPostHistory':
      return 'prompts.boundCharacterListHintPost'
    case 'boundUserInput':
      return 'prompts.boundUserInputListHint'
    default:
      return 'prompts.emptyHint'
  }
}

function bindingSlotEditorDescKey(slot: string | undefined): string {
  switch (slot) {
    case 'boundCharacterSystem':
      return 'prompts.boundCharacterEditorDescSystem'
    case 'boundWorld':
      return 'prompts.boundWorldEditorDesc'
    case 'boundCharacterPostHistory':
      return 'prompts.boundCharacterEditorDescPost'
    case 'boundUserInput':
      return 'prompts.boundUserInputEditorDesc'
    default:
      return 'prompts.editorEmptyHint'
  }
}

function groupIcon(kind: GroupKind): string {
  switch (kind) {
    case 'character':
      return 'mdi-account-outline'
    case 'world':
      return 'mdi-earth'
    case 'history':
      return 'mdi-chat-outline'
    case 'userInput':
      return 'mdi-pencil-outline'
    default:
      return 'mdi-format-list-bulleted'
  }
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  } catch {
    return iso
  }
}

function previewBody(p: PromptEntry) {
  const raw = (p.description || p.content).replace(/\s+/g, ' ').trim()
  if (raw.length <= 80) return raw
  return raw.slice(0, 78).trimEnd() + '…'
}

function entryGroupName(p: PromptEntry) {
  return activeGroups.value.find((g) => g.id === p.groupId)?.name ?? '—'
}

/** 默认选中第一个 normal 分组 */
watch(
  activePresetId,
  () => {
    if (!activeGroupId.value) {
      const firstNormal = activeGroups.value.find((g) => g.kind === 'normal')
      if (firstNormal) store.selectGroup(firstNormal.id)
    }
  },
  { immediate: true },
)

const currentGroup = computed<PromptGroup | null>(() => {
  if (!activeGroupId.value) return null
  return activeGroups.value.find((g) => g.id === activeGroupId.value) ?? null
})

/** 当前分组是否可维护条目列表（含角色卡 system、历史后 post_history） */
const isEntryListGroup = computed(() =>
  currentGroup.value ? groupAllowsPromptEntries(currentGroup.value.kind) : false,
)

/** 占位分组（角色/世界/历史/用户输出）不可删除；前置、后置及用户新建的 normal 分组可删 */
const isPlaceholderGroup = (g: PromptGroup) =>
  g.kind === 'character' ||
  g.kind === 'world' ||
  g.kind === 'history' ||
  g.kind === 'userInput'

const canDeleteGroup = (g: PromptGroup) =>
  g.kind === 'normal' && !isPlaceholderGroup(g)
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
      <!-- ============ Head ============ -->
      <header class="library-page-head">
        <div class="library-page-head__row">
          <h1 class="library-page-head__title">
            {{ $t('prompts.pageTitle') }}
          </h1>
          <div class="library-page-head__aside">
            <p class="library-page-head__lede">
              {{ $t('prompts.lede') }}
            </p>
            <p class="library-page-head__count">
              {{ $t('prompts.count', { n: activePreset.prompts.length }) }}
            </p>
          </div>
        </div>
      </header>

      <!-- ============ Preset bar ============ -->
      <div class="preset-bar">
        <div class="preset-bar__left">
          <span class="preset-bar__label">{{ $t('prompts.presetLabel') }}</span>
          <v-menu v-model="presetSwitchOpen" location="bottom start">
            <template #activator="{ props: act }">
              <button
                type="button"
                class="preset-bar__current"
                v-bind="act"
                :aria-label="$t('prompts.presetSwitch')"
              >
                <span class="preset-bar__current-name">{{ activePreset.name }}</span>
                <v-icon size="14" class="preset-bar__caret">mdi-chevron-down</v-icon>
              </button>
            </template>
            <v-list density="compact" min-width="200">
              <v-list-item
                v-for="p in presets"
                :key="p.id"
                :title="p.name"
                :active="p.id === activePresetId"
                @click="switchPreset(p.id)"
              />
            </v-list>
          </v-menu>
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('prompts.presetNew')"
            :aria-label="$t('prompts.presetNew')"
            @click="openCreatePreset"
          >
            <v-icon size="16">mdi-plus</v-icon>
          </button>
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('prompts.presetDuplicate')"
            :aria-label="$t('prompts.presetDuplicate')"
            @click="performDuplicatePreset"
          >
            <v-icon size="16">mdi-content-duplicate</v-icon>
          </button>
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('prompts.presetRename')"
            :aria-label="$t('prompts.presetRename')"
            @click="openRenamePreset"
          >
            <v-icon size="16">mdi-pencil-outline</v-icon>
          </button>
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('prompts.presetImport')"
            :aria-label="$t('prompts.presetImport')"
            @click="performImportPickFile"
          >
            <v-icon size="16">mdi-tray-arrow-down</v-icon>
          </button>
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('prompts.presetExport')"
            :aria-label="$t('prompts.presetExport')"
            @click="performExportActive"
          >
            <v-icon size="16">mdi-tray-arrow-up</v-icon>
          </button>
          <button
            type="button"
            class="preset-bar__icon-btn preset-bar__icon-btn--danger"
            :title="presets.length <= 1
              ? $t('prompts.presetCannotDeleteLast')
              : $t('prompts.presetDelete')"
            :aria-label="$t('prompts.presetDelete')"
            :disabled="presets.length <= 1"
            @click="openDeletePreset"
          >
            <v-icon size="16">mdi-trash-can-outline</v-icon>
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
          <button
            type="button"
            class="preview-btn"
            @click="openPreview"
          >
            <v-icon size="14" class="mr-1">mdi-eye-outline</v-icon>
            {{ $t('prompts.preview') }}
          </button>
        </div>
      </div>

      <!-- ============ Groups bar ============ -->
      <div
        class="groups-bar"
        role="tablist"
        :aria-label="$t('prompts.groupBarLabel')"
      >
        <template v-for="(g, idx) in activeGroups" :key="g.id">
          <span
            v-if="groupDragOverIdx === idx"
            class="groups-bar__drop-indicator"
          />
          <div
            role="tab"
            :aria-selected="activeGroupId === g.id"
            :tabindex="activeGroupId === g.id ? 0 : -1"
            class="group-chip"
            :class="{
              'is-active': activeGroupId === g.id,
              'is-placeholder': g.kind !== 'normal',
              'is-dragging': groupDragId === g.id,
            }"
            draggable="true"
            @click="selectGroup(g)"
            @dblclick="openRenameGroup(g)"
            @keydown.enter.prevent="selectGroup(g)"
            @keydown.space.prevent="selectGroup(g)"
            @dragstart="onGroupDragStart(g.id, $event)"
            @dragover="onGroupDragOver(idx, $event)"
            @drop="onGroupDrop(idx)"
            @dragend="onGroupDragEnd"
          >
            <v-icon size="13" class="group-chip__icon">
              {{ groupIcon(g.kind) }}
            </v-icon>
            <span class="group-chip__name">{{ g.name }}</span>
            <span class="group-chip__count">{{ groupCounts[g.id] ?? 0 }}</span>
            <button
              type="button"
              class="group-chip__edit"
              :title="$t('prompts.groupRename')"
              :aria-label="$t('prompts.groupRename')"
              @click.stop="openRenameGroup(g)"
            >
              <v-icon size="11">mdi-pencil-outline</v-icon>
            </button>
            <button
              v-if="canDeleteGroup(g)"
              type="button"
              class="group-chip__close"
              :aria-label="$t('prompts.groupDelete')"
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
          :title="$t('prompts.groupAdd')"
          @click="openAddGroup"
          @dragover="onGroupDragOver(activeGroups.length, $event)"
          @drop="onGroupDrop(activeGroups.length)"
        >
          <v-icon size="14">mdi-plus</v-icon>
          <span>{{ $t('prompts.groupAdd') }}</span>
        </button>
      </div>

      <!-- ============ Layout ============ -->
      <div class="prompts-layout">
        <!-- ====== Left list ====== -->
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
              :placeholder="$t('prompts.searchPlaceholder')"
              :aria-label="$t('prompts.searchPlaceholder')"
              @input="store.setSearchText(($event.target as HTMLInputElement).value)"
            />
            <button
              v-if="searchText"
              type="button"
              class="prompts-search__clear"
              :aria-label="$t('prompts.clearSearch')"
              @click="store.setSearchText('')"
            >×</button>
          </div>

          <div class="prompts-list__scroll">
            <button
              v-if="isEntryListGroup"
              type="button"
              class="entry-card entry-card--new"
              @click="createEntry"
            >
              <span class="entry-card--new__plus">+</span>
              <span class="entry-card--new__label">{{ $t('prompts.newPrompt') }}</span>
            </button>

            <template v-for="(p, idx) in visiblePrompts" :key="p.id">
              <span
                v-if="entryDragOverIdx === idx && isEntryListGroup"
                class="entry-drop-indicator"
              />
              <div
                v-if="
                  (
                    p.bindingSlot === 'boundCharacterSystem' &&
                    currentGroup?.kind === 'character'
                  ) ||
                  (
                    p.bindingSlot === 'boundWorld' &&
                    currentGroup?.kind === 'world'
                  ) ||
                  (
                    p.bindingSlot === 'boundCharacterPostHistory' &&
                    currentGroup?.kind === 'history'
                  ) ||
                  (
                    p.bindingSlot === 'boundUserInput' &&
                    currentGroup?.kind === 'userInput'
                  )
                "
                class="character-system-bundle"
                :class="{
                  'is-active': selected?.id === p.id,
                  'is-disabled': !p.enabled,
                  'is-dragging': entryDragId === p.id,
                }"
                tabindex="0"
                draggable="true"
                @click="selectEntry(p.id)"
                @keydown.enter="selectEntry(p.id)"
                @dragstart="onEntryDragStart(p.id, $event)"
                @dragover="onEntryDragOver(idx, $event)"
                @drop="onEntryDrop(idx)"
                @dragend="onEntryDragEnd"
              >
                <div class="character-system-bundle__chrome">
                  <v-icon
                    size="14"
                    class="character-system-bundle__handle"
                    :title="$t('prompts.dragHandle')"
                  >
                    mdi-drag-vertical
                  </v-icon>
                  <v-icon size="20" class="character-system-bundle__icon">
                    {{ groupIcon(currentGroup.kind) }}
                  </v-icon>
                  <div class="character-system-bundle__title">
                    {{ $t('prompts.groupBoundFromChat') }}
                  </div>
                  <div class="character-system-bundle__desc">
                    {{ $t(placeholderDescKey(currentGroup.kind)) }}
                  </div>
                </div>
                <article
                  class="entry-card entry-card--in-character-bundle"
                  :class="{
                    'is-active': selected?.id === p.id,
                    'is-disabled': !p.enabled,
                  }"
                  draggable="false"
                  @click.stop="selectEntry(p.id)"
                >
                  <div class="entry-card__row">
                    <button
                      v-if="!bindingSlotIsRequired(p.bindingSlot)"
                      type="button"
                      class="entry-card__enabled"
                      :class="{ 'is-on': p.enabled }"
                      :aria-pressed="p.enabled"
                      :title="$t('prompts.fieldEnabled')"
                      @click.stop="store.updatePrompt(p.id, { enabled: !p.enabled })"
                    >
                      <span class="entry-card__enabled-dot" />
                    </button>
                    <h2 class="entry-card__title entry-card__title--bundle-inner">
                      {{ $t(bindingSlotLabelKey(p.bindingSlot)) }}
                    </h2>
                    <span class="entry-card__binding">{{ $t('prompts.bindingSlotTag') }}</span>
                  </div>
                  <div class="entry-card__meta entry-card__meta--binding">
                    <span class="entry-card__pos">{{ $t('prompts.positionRelative') }}</span>
                  </div>
                </article>
              </div>
              <article
                v-else
                class="entry-card"
                :class="{
                  'is-active': selected?.id === p.id,
                  'is-disabled': !p.enabled,
                  'is-dragging': entryDragId === p.id,
                }"
                tabindex="0"
                draggable="true"
                @click="selectEntry(p.id)"
                @keydown.enter="selectEntry(p.id)"
                @dragstart="onEntryDragStart(p.id, $event)"
                @dragover="onEntryDragOver(idx, $event)"
                @drop="onEntryDrop(idx)"
                @dragend="onEntryDragEnd"
              >
                <div class="entry-card__row">
                  <v-icon size="14" class="entry-card__handle" :title="$t('prompts.dragHandle')">
                    mdi-drag-vertical
                  </v-icon>
                  <button
                    type="button"
                    class="entry-card__enabled"
                    :class="{ 'is-on': p.enabled }"
                    :aria-pressed="p.enabled"
                    :title="$t('prompts.fieldEnabled')"
                    @click.stop="store.updatePrompt(p.id, { enabled: !p.enabled })"
                  >
                    <span class="entry-card__enabled-dot" />
                  </button>
                  <h2 class="entry-card__title">
                    <template v-if="p.bindingSlot">{{
                      $t(bindingSlotLabelKey(p.bindingSlot))
                    }}</template>
                    <template v-else>{{ p.title || $t('prompts.untitled') }}</template>
                  </h2>
                  <span
                    v-if="p.bindingSlot"
                    class="entry-card__binding"
                  >{{ $t('prompts.bindingSlotTag') }}</span>
                  <span
                    v-else-if="p.isSeed"
                    class="entry-card__seed"
                  >{{ $t('prompts.seedTag') }}</span>
                </div>
                <p
                  v-if="!p.bindingSlot && (p.description || p.content)"
                  class="entry-card__body"
                >{{ previewBody(p) }}</p>
                <div v-if="!p.bindingSlot" class="entry-card__meta">
                  <span class="entry-card__role-chip" :class="`role-${p.role}`">
                    {{ $t(`prompts.role${p.role.charAt(0).toUpperCase() + p.role.slice(1)}`) }}
                  </span>
                  <span
                    class="entry-card__pos"
                    :class="{ 'is-chat': p.injectionPosition === 'chat' }"
                  >
                    {{ p.injectionPosition === 'relative'
                      ? $t('prompts.positionRelative')
                      : `${$t('prompts.positionChat')} · ${$t('prompts.fieldDepth')} ${p.injectionDepth}` }}
                  </span>
                  <span
                    v-if="p.triggers.length"
                    class="entry-card__trigs"
                  >
                    {{ p.triggers.map((t) => $t(`prompts.trigger${t.charAt(0).toUpperCase() + t.slice(1)}`)).join(' · ') }}
                  </span>
                </div>
                <div v-else class="entry-card__meta entry-card__meta--binding">
                  <span class="entry-card__pos">{{ $t('prompts.positionRelative') }}</span>
                </div>
              </article>
            </template>
            <span
              v-if="entryDragOverIdx === visiblePrompts.length && isEntryListGroup"
              class="entry-drop-indicator"
            />

            <div
              v-if="isEntryListGroup && visiblePrompts.length === 0"
              class="prompts-empty"
            >
              <div class="prompts-empty__title">{{ $t('prompts.emptyTitle') }}</div>
              <div class="prompts-empty__hint">{{ $t('prompts.emptyHint') }}</div>
            </div>
          </div>
        </aside>

        <!-- ====== Right editor ====== -->
        <section class="prompts-editor">
          <template v-if="selected?.bindingSlot">
            <div class="editor-card editor-card--binding">
              <header class="editor-card__head">
                <div class="editor-card__head-row editor-card__head-row--binding">
                  <button
                    v-if="!bindingSlotIsRequired(selected.bindingSlot)"
                    type="button"
                    class="editor-card__enabled"
                    :class="{ 'is-on': selected.enabled }"
                    :aria-pressed="selected.enabled"
                    :title="$t('prompts.fieldEnabled')"
                    :aria-label="$t('prompts.fieldEnabled')"
                    @click="onEnabledToggle"
                  >
                    <span class="editor-card__enabled-track" />
                    <span class="editor-card__enabled-thumb" />
                  </button>
                  <h2 class="editor-card__binding-title">
                    {{ $t(bindingSlotLabelKey(selected.bindingSlot)) }}
                  </h2>
                  <span class="editor-card__seed">{{ $t('prompts.bindingSlotTag') }}</span>
                </div>
                <div class="editor-card__meta editor-card__meta--binding-head">
                  <span>
                    <span class="editor-card__meta-label">{{ $t('prompts.fieldGroup') }}</span>
                    {{ entryGroupName(selected) }}
                  </span>
                </div>
              </header>

              <div class="binding-editor__desc">
                <p>{{ $t(bindingSlotListHintKey(selected.bindingSlot)) }}</p>
                <p>{{ $t(bindingSlotEditorDescKey(selected.bindingSlot)) }}</p>
              </div>

              <footer class="editor-card__foot">
                <span class="editor-card__autosave">{{ $t('prompts.autosaveHint') }}</span>
              </footer>
            </div>
          </template>

          <template v-else-if="selected">
            <div class="editor-card">
              <header class="editor-card__head">
                <div class="editor-card__head-row">
                  <button
                    type="button"
                    class="editor-card__enabled"
                    :class="{ 'is-on': selected.enabled }"
                    :aria-pressed="selected.enabled"
                    :title="$t('prompts.fieldEnabled')"
                    @click="onEnabledToggle"
                  >
                    <span class="editor-card__enabled-track" />
                    <span class="editor-card__enabled-thumb" />
                  </button>
                  <input
                    ref="titleInputRef"
                    :value="selected.title"
                    type="text"
                    class="editor-card__title-input"
                    :placeholder="$t('prompts.titlePlaceholder')"
                    :aria-label="$t('prompts.fieldTitle')"
                    @input="onTitleInput"
                  />
                  <span v-if="selected.isSeed" class="editor-card__seed">
                    {{ $t('prompts.seedTag') }}
                  </span>
                </div>
                <input
                  :value="selected.description"
                  type="text"
                  class="editor-card__description-input"
                  :placeholder="$t('prompts.descriptionPlaceholder')"
                  :aria-label="$t('prompts.fieldDescription')"
                  @input="onDescriptionInput"
                />
                <div class="editor-card__meta">
                  <span>
                    <span class="editor-card__meta-label">{{ $t('prompts.fieldGroup') }}</span>
                    {{ entryGroupName(selected) }}
                  </span>
                  <span>
                    <span class="editor-card__meta-label">{{ $t('prompts.fieldUpdatedAt') }}</span>
                    {{ formatDate(selected.updatedAt) }}
                  </span>
                  <span>
                    <span class="editor-card__meta-label">{{ $t('prompts.fieldChars') }}</span>
                    {{ selected.content.length }}
                  </span>
                </div>
              </header>

              <div class="editor-card__field-row">
                <div class="editor-card__field-block">
                  <label class="editor-card__field-label">{{ $t('prompts.fieldRole') }}</label>
                  <div class="pill-group">
                    <button
                      v-for="opt in ROLE_OPTIONS"
                      :key="opt.id"
                      type="button"
                      class="pill"
                      :class="{ 'is-on': selected.role === opt.id, [`role-${opt.id}`]: true }"
                      @click="setRole(opt.id)"
                    >{{ $t(opt.key) }}</button>
                  </div>
                </div>

                <div class="editor-card__field-block">
                  <label class="editor-card__field-label">
                    {{ $t('prompts.fieldPosition') }}
                    <span class="editor-card__field-hint">
                      {{ selected.injectionPosition === 'relative'
                        ? $t('prompts.positionRelativeHint')
                        : $t('prompts.positionChatHint') }}
                    </span>
                  </label>
                  <div class="pill-group">
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': selected.injectionPosition === 'relative' }"
                      @click="setPosition('relative')"
                    >{{ $t('prompts.positionRelative') }}</button>
                    <button
                      type="button"
                      class="pill"
                      :class="{ 'is-on': selected.injectionPosition === 'chat' }"
                      @click="setPosition('chat')"
                    >{{ $t('prompts.positionChat') }}</button>
                    <template v-if="selected.injectionPosition === 'chat'">
                      <span class="pill-divider" />
                      <span class="num-field">
                        <span class="num-field__label">{{ $t('prompts.fieldDepth') }}</span>
                        <input
                          :value="selected.injectionDepth"
                          type="number"
                          min="0"
                          class="num-field__input"
                          :title="$t('prompts.depthHint')"
                          @input="onDepthInput"
                        />
                      </span>
                      <span class="num-field">
                        <span class="num-field__label">{{ $t('prompts.fieldOrder') }}</span>
                        <input
                          :value="selected.injectionOrder"
                          type="number"
                          class="num-field__input"
                          :title="$t('prompts.orderHint')"
                          @input="onOrderInput"
                        />
                      </span>
                    </template>
                  </div>
                </div>
              </div>

              <div class="editor-card__field">
                <label class="editor-card__field-label">
                  {{ $t('prompts.fieldTriggers') }}
                  <span class="editor-card__field-hint">{{ $t('prompts.triggersHint') }}</span>
                </label>
                <div class="pill-group">
                  <button
                    v-for="opt in TRIGGER_OPTIONS"
                    :key="opt.id"
                    type="button"
                    class="pill pill--check"
                    :class="{ 'is-on': selected.triggers.includes(opt.id) }"
                    @click="toggleTrigger(opt.id)"
                  >
                    <span class="pill__tick">{{ selected.triggers.includes(opt.id) ? '✓' : '' }}</span>
                    {{ $t(opt.key) }}
                  </button>
                </div>
              </div>

              <div class="editor-card__field">
                <label class="editor-card__field-label">
                  {{ $t('prompts.fieldTags') }}
                  <span class="editor-card__field-hint">{{ $t('prompts.tagsHint') }}</span>
                </label>
                <input
                  v-model="tagsInput"
                  type="text"
                  class="editor-card__tags-input"
                  :placeholder="$t('prompts.tagsPlaceholder')"
                />
              </div>

              <div class="editor-card__field">
                <label class="editor-card__field-label">
                  {{ $t('prompts.fieldContent') }}
                  <span class="editor-card__field-hint">{{ $t('prompts.contentHint') }}</span>
                </label>
                <textarea
                  :value="selected.content"
                  class="editor-card__content-input"
                  rows="12"
                  spellcheck="false"
                  :placeholder="$t('prompts.contentPlaceholder')"
                  @input="onContentInput"
                ></textarea>
              </div>

              <footer class="editor-card__foot">
                <span class="editor-card__autosave">{{ $t('prompts.autosaveHint') }}</span>
                <span class="editor-card__actions">
                  <button
                    type="button"
                    class="editor-card__btn"
                    @click="duplicateCurrent"
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
                  >{{ $t('prompts.deletePrompt') }}</button>
                </span>
              </footer>
            </div>
          </template>

          <template v-else>
            <div class="editor-empty">
              <v-icon size="44" class="editor-empty__icon">
                {{ currentGroup ? groupIcon(currentGroup.kind) : 'mdi-file-document-outline' }}
              </v-icon>
              <h2 class="editor-empty__title">
                {{ currentGroup && !isEntryListGroup
                  ? $t('prompts.groupBoundFromChat')
                  : $t('prompts.editorEmptyTitle') }}
              </h2>
              <p class="editor-empty__hint">
                {{ currentGroup && !isEntryListGroup
                  ? $t(placeholderDescKey(currentGroup.kind))
                  : $t('prompts.editorEmptyHint') }}
              </p>
              <button
                v-if="isEntryListGroup"
                type="button"
                class="editor-empty__cta"
                @click="createEntry"
              >+ {{ $t('prompts.newPrompt') }}</button>
            </div>
          </template>
        </section>
      </div>
    </div>

    <!-- ============ Dialogs ============ -->
    <v-dialog v-model="presetCreateOpen">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('prompts.presetNewDialogTitle') }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="presetCreateName"
            :label="$t('prompts.presetNewName')"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            autofocus
            @keydown.enter.prevent="submitCreatePreset"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="presetCreateOpen = false">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!presetCreateName.trim()" @click="submitCreatePreset">
            {{ $t('settings.themeConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="presetRenameOpen">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('prompts.presetRenameDialogTitle') }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="presetRenameDraft"
            :label="$t('prompts.presetNewName')"
            variant="outlined"
            density="comfortable"
            hide-details="auto"
            autofocus
            @keydown.enter.prevent="submitRenamePreset"
          />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="presetRenameOpen = false">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!presetRenameDraft.trim()" @click="submitRenamePreset">
            {{ $t('settings.themeConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="importErrorOpen">
      <v-card>
        <v-card-title class="text-subtitle-1">
          {{ $t('prompts.presetImportErrorTitle') }}
        </v-card-title>
        <v-card-text class="text-body-2">{{ importErrorMsg }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn color="primary" variant="flat" @click="importErrorOpen = false">
            {{ $t('prompts.previewClose') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="presetDeleteOpen">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('prompts.presetDeleteDialogTitle') }}</v-card-title>
        <v-card-text class="text-body-2">
          {{ $t('prompts.presetDeleteDialogBody', { name: activePreset.name }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="presetDeleteOpen = false">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="error" variant="flat" @click="performDeletePreset">{{ $t('prompts.presetDelete') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="groupAddOpen">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('prompts.groupAddDialogTitle') }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="groupAddName"
            :label="$t('prompts.groupAddName')"
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

    <v-dialog v-model="groupRenameOpen">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('prompts.groupRenameDialogTitle') }}</v-card-title>
        <v-card-text>
          <v-text-field
            v-model="groupRenameDraft"
            :label="$t('prompts.groupAddName')"
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
          <v-btn color="primary" variant="flat" :disabled="!groupRenameDraft.trim()" @click="submitRenameGroup">
            {{ $t('settings.themeConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="groupDeleteOpen">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('prompts.groupDeleteDialogTitle') }}</v-card-title>
        <v-card-text class="text-body-2">
          {{ $t('prompts.groupDeleteDialogBody', { name: groupDeleteTarget?.name ?? '' }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="groupDeleteOpen = false">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="error" variant="flat" @click="performDeleteGroup">{{ $t('prompts.groupDelete') }}</v-btn>
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

    <v-dialog v-model="entryDeleteOpen">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('prompts.deleteDialogTitle') }}</v-card-title>
        <v-card-text class="text-body-2">
          {{ $t('prompts.deleteDialogBody', { title: selected?.title || $t('prompts.untitled') }) }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="entryDeleteOpen = false">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="error" variant="flat" @click="performDeleteEntry">{{ $t('prompts.deletePrompt') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ============ Preview modal ============ -->
    <v-dialog v-model="previewOpen" scrollable>
      <v-card class="preview-card">
        <v-card-title class="preview-card__title">
          <span>{{ $t('prompts.previewDialogTitle') }}</span>
          <v-spacer />
          <v-btn
            icon="mdi-close"
            variant="text"
            density="comfortable"
            @click="previewOpen = false"
          />
        </v-card-title>
        <div class="preview-card__topbar">
          <span class="preview-card__topbar-label">{{ $t('prompts.previewTriggerLabel') }}</span>
          <div class="pill-group">
            <button
              type="button"
              class="pill"
              :class="{ 'is-on': previewTrigger === 'all' }"
              @click="previewTrigger = 'all'"
            >{{ $t('prompts.previewTriggerAll') }}</button>
            <button
              v-for="opt in TRIGGER_OPTIONS"
              :key="opt.id"
              type="button"
              class="pill"
              :class="{ 'is-on': previewTrigger === opt.id }"
              @click="previewTrigger = opt.id"
            >{{ $t(opt.key) }}</button>
          </div>
          <span class="preview-card__topbar-sep" />
          <span class="preview-card__meta">
            <span class="preview-card__meta-label">{{ $t('prompts.previewMessagesLabel') }}</span>
            {{ previewResult?.messages.length ?? 0 }}
          </span>
          <span class="preview-card__meta">
            <span class="preview-card__meta-label">{{ $t('prompts.previewTokensLabel') }}</span>
            {{ previewResult?.estimatedTokens ?? 0 }}
          </span>
          <span
            v-if="(previewResult?.droppedHistoryCount ?? 0) > 0"
            class="preview-card__meta preview-card__meta--warn"
          >
            {{ $t('prompts.previewDropped', { n: previewResult?.droppedHistoryCount ?? 0 }) }}
          </span>
        </div>
        <v-card-text class="preview-card__body">
          <v-progress-linear
            v-if="previewLoading"
            indeterminate
            class="mb-2 rounded"
            color="primary"
          />
          <v-alert
            v-else-if="previewError"
            type="error"
            variant="tonal"
            density="compact"
            class="mb-0"
          >
            {{ previewError }}
          </v-alert>
          <pre
            v-else
            class="preview-card__json"
          >{{ previewJson }}</pre>
        </v-card-text>
        <v-card-actions class="preview-card__foot">
          <v-spacer />
          <button
            type="button"
            class="editor-card__btn"
            :class="{ 'is-flash': previewCopiedFlash }"
            @click="copyPreviewJson"
          >{{ previewCopiedFlash ? $t('prompts.previewCopied') : $t('prompts.previewCopy') }}</button>
          <v-btn variant="text" @click="previewOpen = false">{{ $t('prompts.previewClose') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Shared with LorebooksView — see @/styles/prompts-library.css */
</style>
