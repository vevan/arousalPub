<script setup lang="ts">
import {
  DEFAULT_GROUP_IDS,
  usePromptsStore,
} from '@/stores/prompts'
import type {
  GroupKind,
  PromptEntry,
  PromptGroup,
  PromptRole,
  PromptTrigger,
} from '@/stores/prompts'
import { assemblePrompts } from '@/utils/assemble-prompts'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, watch } from 'vue'

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
  if (g.kind !== 'normal') return
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
  if (!g || g.kind !== 'normal') return
  store.createPrompt(gid)
  void nextTick(() => titleInputRef.value?.focus())
}

function duplicateCurrent() {
  if (!selected.value) return
  store.duplicatePrompt(selected.value.id)
}

const copiedFlash = ref(false)
async function copyCurrent() {
  if (!selected.value) return
  try {
    await navigator.clipboard.writeText(selected.value.content)
    copiedFlash.value = true
    setTimeout(() => (copiedFlash.value = false), 1200)
  } catch {
    /* ignore */
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
const previewTrigger = ref<PromptTrigger | 'all'>('all')
const previewCopiedFlash = ref(false)

function openPreview() {
  previewTrigger.value = 'all'
  previewOpen.value = true
}

const previewResult = computed(() => {
  if (!previewOpen.value) return null
  return assemblePrompts(activePreset.value, {
    trigger:
      previewTrigger.value === 'all' ? undefined : previewTrigger.value,
  })
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

const isCurrentGroupNormal = computed(() => currentGroup.value?.kind === 'normal')

const isDefaultGroup = (id: string) =>
  id === DEFAULT_GROUP_IDS.pre ||
  id === DEFAULT_GROUP_IDS.character ||
  id === DEFAULT_GROUP_IDS.world ||
  id === DEFAULT_GROUP_IDS.history ||
  id === DEFAULT_GROUP_IDS.userInput ||
  id === DEFAULT_GROUP_IDS.post
</script>

<template>
  <div class="prompts-view flex-grow-1 d-flex flex-column min-height-0">
    <div class="prompts-view__inner mx-auto w-100">
      <!-- ============ Head ============ -->
      <header class="list-head">
        <div class="d-flex align-baseline" style="gap: 14px">
          <h1 class="list-head__title">{{ $t('prompts.pageTitle') }}</h1>
          <span class="list-head__tag">{{ $t('prompts.brand') }}</span>
        </div>
        <span class="list-head__sub">
          {{ $t('prompts.count', { n: activePreset.prompts.length }) }}
        </span>
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
          <button
            type="button"
            role="tab"
            :aria-selected="activeGroupId === g.id"
            class="group-chip"
            :class="{
              'is-active': activeGroupId === g.id,
              'is-placeholder': g.kind !== 'normal',
              'is-dragging': groupDragId === g.id,
            }"
            draggable="true"
            @click="selectGroup(g)"
            @dblclick="openRenameGroup(g)"
            @dragstart="onGroupDragStart(g.id, $event)"
            @dragover="onGroupDragOver(idx, $event)"
            @drop="onGroupDrop(idx)"
            @dragend="onGroupDragEnd"
          >
            <v-icon size="13" class="group-chip__icon">
              {{ groupIcon(g.kind) }}
            </v-icon>
            <span class="group-chip__name">{{ g.name }}</span>
            <span
              v-if="g.kind === 'normal'"
              class="group-chip__count"
            >{{ groupCounts[g.id] ?? 0 }}</span>
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
              v-if="g.kind === 'normal' && !isDefaultGroup(g.id)"
              type="button"
              class="group-chip__close"
              :aria-label="$t('prompts.groupDelete')"
              @click.stop="openDeleteGroup(g)"
            >×</button>
          </button>
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
              v-if="isCurrentGroupNormal"
              type="button"
              class="entry-card entry-card--new"
              @click="createEntry"
            >
              <span class="entry-card--new__plus">+</span>
              <span class="entry-card--new__label">{{ $t('prompts.newPrompt') }}</span>
            </button>

            <template v-if="!isCurrentGroupNormal && currentGroup">
              <div class="bound-card">
                <v-icon size="20" class="bound-card__icon">{{ groupIcon(currentGroup.kind) }}</v-icon>
                <div class="bound-card__title">{{ $t('prompts.groupBoundFromChat') }}</div>
                <div class="bound-card__desc">{{ $t(placeholderDescKey(currentGroup.kind)) }}</div>
              </div>
            </template>

            <template v-for="(p, idx) in visiblePrompts" :key="p.id">
              <span
                v-if="entryDragOverIdx === idx && isCurrentGroupNormal"
                class="entry-drop-indicator"
              />
              <article
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
                    {{ p.title || $t('prompts.untitled') }}
                  </h2>
                  <span
                    v-if="p.isSeed"
                    class="entry-card__seed"
                  >{{ $t('prompts.seedTag') }}</span>
                </div>
                <p
                  v-if="p.description || p.content"
                  class="entry-card__body"
                >{{ previewBody(p) }}</p>
                <div class="entry-card__meta">
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
              </article>
            </template>
            <span
              v-if="entryDragOverIdx === visiblePrompts.length && isCurrentGroupNormal"
              class="entry-drop-indicator"
            />

            <div
              v-if="isCurrentGroupNormal && visiblePrompts.length === 0"
              class="prompts-empty"
            >
              <div class="prompts-empty__title">{{ $t('prompts.emptyTitle') }}</div>
              <div class="prompts-empty__hint">{{ $t('prompts.emptyHint') }}</div>
            </div>
          </div>
        </aside>

        <!-- ====== Right editor ====== -->
        <section class="prompts-editor">
          <template v-if="selected">
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
                    :class="{ 'is-flash': copiedFlash }"
                    @click="copyCurrent"
                  >{{ copiedFlash ? $t('prompts.copied') : $t('prompts.copyContent') }}</button>
                  <button
                    type="button"
                    class="editor-card__btn"
                    @click="duplicateCurrent"
                  >{{ $t('prompts.duplicate') }}</button>
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
                {{ currentGroup && currentGroup.kind !== 'normal'
                  ? $t('prompts.groupBoundFromChat')
                  : $t('prompts.editorEmptyTitle') }}
              </h2>
              <p class="editor-empty__hint">
                {{ currentGroup && currentGroup.kind !== 'normal'
                  ? $t(placeholderDescKey(currentGroup.kind))
                  : $t('prompts.editorEmptyHint') }}
              </p>
              <button
                v-if="isCurrentGroupNormal"
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
    <v-dialog v-model="presetCreateOpen" max-width="26rem">
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

    <v-dialog v-model="presetRenameOpen" max-width="26rem">
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

    <v-dialog v-model="importErrorOpen" max-width="26rem">
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

    <v-dialog v-model="presetDeleteOpen" max-width="26rem">
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

    <v-dialog v-model="groupAddOpen" max-width="26rem">
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

    <v-dialog v-model="groupRenameOpen" max-width="26rem">
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

    <v-dialog v-model="groupDeleteOpen" max-width="26rem">
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

    <v-dialog v-model="entryDeleteOpen" max-width="24rem">
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
    <v-dialog v-model="previewOpen" max-width="62rem" scrollable>
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
            ~{{ previewResult?.estimatedTokens ?? 0 }}
          </span>
          <span
            v-if="(previewResult?.droppedHistoryCount ?? 0) > 0"
            class="preview-card__meta preview-card__meta--warn"
          >
            {{ $t('prompts.previewDropped', { n: previewResult?.droppedHistoryCount ?? 0 }) }}
          </span>
        </div>
        <v-card-text class="preview-card__body">
          <pre class="preview-card__json">{{ previewJson }}</pre>
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
.prompts-view {
  position: relative;
  padding: 24px 28px 32px;
  overflow-y: auto;
}
.prompts-view__inner {
  max-width: 88rem;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.min-height-0 { min-height: 0; }

/* ========== Head ========== */
.list-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin: 0 0 4px;
  padding: 0 4px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.list-head__title {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 500;
  font-size: 26px;
  letter-spacing: 0.005em;
  color: rgb(var(--v-theme-on-surface));
}
.list-head__tag {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-primary), 0.85);
  border: 1px solid rgba(var(--v-theme-primary), 0.4);
  padding: 2px 8px;
  border-radius: 3px;
}
.list-head__sub {
  font-family: var(--font-mono);
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.45);
}

/* ========== Preset bar ========== */
.preset-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 10px;
  background: rgb(var(--v-theme-surface-light));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 7px;
}
.preset-bar__left {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
}
.preset-bar__label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-right: 4px;
}
.preset-bar__current {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 28px;
  padding: 0 10px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: 4px;
  color: rgb(var(--v-theme-on-surface));
  font-family: var(--font-display);
  font-size: 14px;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: border-color 0.15s;
}
.preset-bar__current:hover {
  border-color: rgba(var(--v-theme-primary), 0.5);
}
.preset-bar__caret {
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.preset-bar__icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  color: rgba(var(--v-theme-on-surface), 0.6);
  cursor: pointer;
  transition: all 0.15s;
}
.preset-bar__icon-btn:hover {
  background: rgb(var(--v-theme-surface));
  border-color: rgba(var(--v-theme-on-surface), 0.10);
  color: rgb(var(--v-theme-on-surface));
}
.preset-bar__icon-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}
.preset-bar__icon-btn--danger:hover:not(:disabled) {
  border-color: rgba(var(--v-theme-error, 198 81 78), 0.5);
  color: rgb(var(--v-theme-error, 198 81 78));
}
.preview-btn {
  display: inline-flex;
  align-items: center;
  height: 28px;
  padding: 0 12px;
  background: rgba(var(--v-theme-primary), 0.12);
  border: 1px solid rgba(var(--v-theme-primary), 0.5);
  border-radius: 4px;
  color: rgb(var(--v-theme-on-surface));
  font-family: var(--font-ui);
  font-size: 12.5px;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: all 0.15s;
}
.preview-btn:hover {
  background: rgba(var(--v-theme-primary), 0.2);
  border-color: rgb(var(--v-theme-primary));
}

/* ========== Groups bar ========== */
.groups-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 8px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  overflow-x: auto;
  scrollbar-width: thin;
}
.group-chip {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px;
  background: transparent;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: 5px;
  color: rgba(var(--v-theme-on-surface), 0.75);
  font-family: var(--font-ui);
  font-size: 12.5px;
  letter-spacing: 0.005em;
  cursor: grab;
  white-space: nowrap;
  transition: all 0.15s;
  user-select: none;
}
.group-chip:active { cursor: grabbing; }
.group-chip:hover {
  border-color: rgba(var(--v-theme-primary), 0.4);
  color: rgb(var(--v-theme-on-surface));
}
.group-chip.is-active {
  background: rgba(var(--v-theme-primary), 0.14);
  border-color: rgba(var(--v-theme-primary), 0.6);
  color: rgb(var(--v-theme-on-surface));
  box-shadow: inset 0 -2px 0 rgb(var(--v-theme-primary));
}
.group-chip.is-placeholder {
  background: rgb(var(--v-theme-surface-light));
  font-style: italic;
}
.group-chip.is-placeholder .group-chip__icon {
  color: rgba(var(--v-theme-secondary), 0.8);
}
.group-chip.is-dragging { opacity: 0.4; }
.group-chip__icon {
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.group-chip__name {
  font-family: var(--font-display);
  font-size: 13.5px;
}
.group-chip__count {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.group-chip.is-active .group-chip__count { color: rgba(var(--v-theme-primary), 0.9); }
.group-chip__edit,
.group-chip__close {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  border-radius: 50%;
  color: rgba(var(--v-theme-on-surface), 0.45);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
  margin-left: 2px;
  opacity: 0;
  transition: opacity 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.group-chip:hover .group-chip__edit,
.group-chip.is-active .group-chip__edit,
.group-chip:hover .group-chip__close,
.group-chip.is-active .group-chip__close {
  opacity: 1;
}
.group-chip__edit:hover {
  background: rgba(var(--v-theme-primary), 0.16);
  color: rgb(var(--v-theme-primary));
}
.group-chip__close:hover {
  background: rgba(var(--v-theme-error, 198 81 78), 0.18);
  color: rgb(var(--v-theme-error, 198 81 78));
}
.group-chip--add {
  border: 1px dashed rgba(var(--v-theme-primary), 0.4);
  color: rgba(var(--v-theme-primary), 0.85);
  cursor: pointer;
}
.group-chip--add:hover {
  background: rgba(var(--v-theme-primary), 0.05);
  border-color: rgb(var(--v-theme-primary));
}
.groups-bar__drop-indicator {
  display: inline-block;
  width: 2px;
  height: 24px;
  background: rgb(var(--v-theme-primary));
  border-radius: 1px;
  margin: 0 -1px;
}

/* ========== Layout ========== */
.prompts-layout {
  display: grid;
  grid-template-columns: clamp(20rem, 28%, 26rem) 1fr;
  gap: 16px;
  align-items: stretch;
  min-height: 0;
}
@media (max-width: 920px) {
  .prompts-layout { grid-template-columns: 1fr; }
}

/* ========== Left list ========== */
.prompts-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  min-width: 0;
}
.prompts-search {
  position: relative;
  display: flex;
  align-items: center;
}
.prompts-search__icon {
  position: absolute;
  left: 10px;
  width: 14px;
  height: 14px;
  color: rgba(var(--v-theme-on-surface), 0.45);
  pointer-events: none;
}
.prompts-search__input {
  width: 100%;
  height: 32px;
  padding: 0 28px 0 30px;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface));
  font-family: var(--font-ui);
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
}
.prompts-search__input:focus { border-color: rgba(var(--v-theme-primary), 0.55); }
.prompts-search__input::placeholder { color: rgba(var(--v-theme-on-surface), 0.35); }
.prompts-search__clear {
  position: absolute;
  right: 6px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 0;
  border-radius: 50%;
  color: rgba(var(--v-theme-on-surface), 0.5);
  font-size: 18px;
  cursor: pointer;
}
.prompts-search__clear:hover {
  background: rgba(var(--v-theme-on-surface), 0.08);
  color: rgb(var(--v-theme-on-surface));
}

.prompts-list__scroll {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: calc(100vh - var(--header-height, 56px) - var(--footer-height, 28px) - 320px);
  overflow-y: auto;
  padding-right: 4px;
  margin-right: -4px;
}

/* Bound (placeholder group) info card */
.bound-card {
  padding: 22px 18px;
  background: rgb(var(--v-theme-surface-light));
  border: 1px dashed rgba(var(--v-theme-secondary), 0.4);
  border-radius: 7px;
  text-align: center;
}
.bound-card__icon { color: rgba(var(--v-theme-secondary), 0.85); margin-bottom: 6px; }
.bound-card__title {
  font-family: var(--font-display);
  font-style: italic;
  font-size: 14.5px;
  color: rgba(var(--v-theme-secondary), 0.9);
  margin-bottom: 4px;
}
.bound-card__desc {
  font-family: var(--font-ui);
  font-size: 11.5px;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.5);
}

/* Entry card */
.entry-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px 10px 12px;
  background: rgb(var(--v-theme-surface-light));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 6px;
  cursor: grab;
  text-align: start;
  font: inherit;
  color: inherit;
  outline: none;
  transition: all 0.14s;
}
.entry-card:active { cursor: grabbing; }
.entry-card:hover,
.entry-card:focus-visible {
  border-color: rgba(var(--v-theme-primary), 0.35);
  background: rgb(var(--v-theme-surface-bright));
}
.entry-card.is-active {
  border-color: rgba(var(--v-theme-primary), 0.55);
  background: rgb(var(--v-theme-surface-bright));
  box-shadow: 0 0 0 1px rgba(var(--v-theme-primary), 0.22);
}
.entry-card.is-dragging { opacity: 0.4; }
.entry-card.is-disabled { opacity: 0.45; }

.entry-card__row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.entry-card__handle { color: rgba(var(--v-theme-on-surface), 0.35); flex-shrink: 0; cursor: grab; }
.entry-card__enabled {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1.5px solid rgba(var(--v-theme-on-surface), 0.3);
  border-radius: 3px;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
}
.entry-card__enabled-dot {
  width: 6px;
  height: 6px;
  border-radius: 2px;
  background: transparent;
  transition: background 0.12s;
}
.entry-card__enabled.is-on {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-primary));
}
.entry-card__enabled.is-on .entry-card__enabled-dot { background: rgb(var(--v-theme-surface)); }
.entry-card__title {
  margin: 0;
  flex: 1;
  font-family: var(--font-display);
  font-size: 14px;
  font-weight: 500;
  line-height: 1.3;
  color: rgb(var(--v-theme-on-surface));
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.entry-card__seed {
  font-family: var(--font-mono);
  font-size: 8.5px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 2px;
  padding: 1px 5px;
}
.entry-card__body {
  margin: 0;
  font-family: var(--font-ui);
  font-size: 11.5px;
  line-height: 1.45;
  color: rgba(var(--v-theme-on-surface), 0.6);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}
.entry-card__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  margin-top: 2px;
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.04em;
}
.entry-card__role-chip {
  padding: 1px 5px;
  border-radius: 2px;
  text-transform: lowercase;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.entry-card__role-chip.role-system {
  border-color: rgba(var(--v-theme-secondary), 0.5);
  color: rgba(var(--v-theme-secondary), 0.9);
}
.entry-card__role-chip.role-user {
  border-color: rgba(var(--v-theme-primary), 0.5);
  color: rgba(var(--v-theme-primary), 0.9);
}
.entry-card__role-chip.role-assistant {
  border-color: rgba(122, 143, 106, 0.6);
  color: rgba(122, 143, 106, 1);
}
.entry-card__pos {
  color: rgba(var(--v-theme-on-surface), 0.5);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}
.entry-card__pos.is-chat {
  color: rgba(var(--v-theme-primary), 0.85);
}
.entry-card__trigs {
  color: rgba(var(--v-theme-on-surface), 0.4);
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.entry-card--new {
  align-items: center;
  flex-direction: row;
  justify-content: center;
  gap: 8px;
  padding: 10px 12px;
  background: transparent;
  border: 1px dashed rgba(var(--v-theme-primary), 0.35);
  color: rgba(var(--v-theme-on-surface), 0.7);
  cursor: pointer;
}
.entry-card--new:hover {
  background: rgba(var(--v-theme-primary), 0.05);
  border-color: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-surface));
}
.entry-card--new__plus {
  font-family: var(--font-display);
  font-size: 16px;
  color: rgb(var(--v-theme-primary));
  line-height: 1;
}
.entry-card--new__label {
  font-family: var(--font-display);
  font-size: 13px;
  font-style: italic;
}

.entry-drop-indicator {
  display: block;
  height: 2px;
  background: rgb(var(--v-theme-primary));
  border-radius: 1px;
  margin: -2px 0;
}

.prompts-empty {
  padding: 24px 18px;
  text-align: center;
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.prompts-empty__title {
  font-family: var(--font-display);
  font-size: 14px;
  font-style: italic;
}
.prompts-empty__hint {
  font-family: var(--font-ui);
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.4);
  margin-top: 2px;
}

/* ========== Right editor ========== */
.prompts-editor {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 0;
}
.editor-card {
  display: flex;
  flex-direction: column;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.08);
  border-radius: 8px;
  overflow: hidden;
}
.editor-card__head {
  padding: 16px 22px 14px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: linear-gradient(180deg, rgba(var(--v-theme-surface-bright), 0.5), transparent);
}
.editor-card__head-row {
  display: flex;
  align-items: center;
  gap: 12px;
}
.editor-card__enabled {
  position: relative;
  width: 32px;
  height: 18px;
  border-radius: 999px;
  background: rgba(var(--v-theme-on-surface), 0.18);
  border: 0;
  cursor: pointer;
  flex-shrink: 0;
  padding: 0;
  transition: background 0.15s;
}
.editor-card__enabled.is-on { background: rgb(var(--v-theme-primary)); }
.editor-card__enabled-track { display: none; }
.editor-card__enabled-thumb {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: rgb(var(--v-theme-on-surface));
  transition: all 0.15s;
}
.editor-card__enabled.is-on .editor-card__enabled-thumb {
  left: 16px;
  background: rgb(var(--v-theme-surface));
}

.editor-card__title-input {
  flex: 1;
  background: transparent;
  border: 0;
  outline: none;
  padding: 4px 0;
  font-family: var(--font-display);
  font-size: 22px;
  font-weight: 500;
  letter-spacing: 0.005em;
  color: rgb(var(--v-theme-on-surface));
}
.editor-card__title-input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.3);
  font-style: italic;
}
.editor-card__seed {
  font-family: var(--font-mono);
  font-size: 9.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.14);
  border-radius: 2px;
  padding: 1px 6px;
  color: rgba(var(--v-theme-secondary), 0.85);
}

.editor-card__description-input {
  width: 100%;
  background: transparent;
  border: 0;
  outline: none;
  padding: 6px 0 8px;
  font-family: var(--font-ui);
  font-size: 13px;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.editor-card__description-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.3); }

.editor-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: 18px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.04em;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.editor-card__meta-label {
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-right: 4px;
  color: rgba(var(--v-theme-on-surface), 0.3);
}

.editor-card__field-row {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 2fr);
  gap: 0;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.editor-card__field-block {
  padding: 12px 22px;
}
.editor-card__field-block + .editor-card__field-block {
  border-left: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}

.editor-card__field {
  padding: 12px 22px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.05);
}
.editor-card__field:last-of-type { border-bottom: 0; }
.editor-card__field-label {
  display: flex;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 8px;
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.55);
}
.editor-card__field-hint {
  font-family: var(--font-ui);
  font-size: 11px;
  letter-spacing: 0;
  text-transform: none;
  color: rgba(var(--v-theme-on-surface), 0.4);
  font-style: italic;
}

/* pills */
.pill-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
}
.pill {
  height: 24px;
  padding: 0 10px;
  background: transparent;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: 3px;
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-family: var(--font-ui);
  font-size: 11.5px;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.pill:hover {
  border-color: rgba(var(--v-theme-primary), 0.4);
  color: rgb(var(--v-theme-on-surface));
}
.pill.is-on {
  background: rgba(var(--v-theme-primary), 0.14);
  border-color: rgba(var(--v-theme-primary), 0.55);
  color: rgb(var(--v-theme-on-surface));
}
.pill.role-system.is-on {
  background: rgba(var(--v-theme-secondary), 0.16);
  border-color: rgba(var(--v-theme-secondary), 0.55);
}
.pill--check .pill__tick {
  width: 9px;
  font-size: 11px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  text-align: center;
}
.pill-divider {
  width: 1px;
  height: 16px;
  background: rgba(var(--v-theme-on-surface), 0.12);
  margin: 0 4px;
}
.num-field {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.num-field__label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.num-field__input {
  width: 50px;
  height: 22px;
  padding: 0 6px;
  background: rgb(var(--v-theme-surface-light));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: 3px;
  color: rgb(var(--v-theme-on-surface));
  font-family: var(--font-mono);
  font-size: 11.5px;
  text-align: right;
  outline: none;
}
.num-field__input:focus { border-color: rgba(var(--v-theme-primary), 0.5); }
.num-field__input::-webkit-inner-spin-button,
.num-field__input::-webkit-outer-spin-button { opacity: 0.4; }

.editor-card__tags-input {
  width: 100%;
  height: 30px;
  padding: 0 10px;
  background: rgb(var(--v-theme-surface-light));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: 4px;
  color: rgb(var(--v-theme-on-surface));
  font-family: var(--font-mono);
  font-size: 12px;
  letter-spacing: 0.02em;
  outline: none;
  transition: border-color 0.15s;
}
.editor-card__tags-input:focus { border-color: rgba(var(--v-theme-primary), 0.5); }
.editor-card__tags-input::placeholder { color: rgba(var(--v-theme-on-surface), 0.3); }

.editor-card__content-input {
  width: 100%;
  padding: 12px 16px;
  background: rgb(var(--v-theme-surface-light));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.10);
  border-radius: 4px;
  color: rgb(var(--v-theme-on-surface));
  font-family: var(--font-mono);
  font-size: 12.5px;
  line-height: 1.65;
  resize: vertical;
  outline: none;
  transition: border-color 0.15s;
}
.editor-card__content-input:focus { border-color: rgba(var(--v-theme-primary), 0.5); }
.editor-card__content-input::placeholder {
  color: rgba(var(--v-theme-on-surface), 0.3);
  font-style: italic;
}

.editor-card__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 10px 22px;
  border-top: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  background: rgba(var(--v-theme-surface-bright), 0.3);
}
.editor-card__autosave {
  font-family: var(--font-mono);
  font-size: 10.5px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.editor-card__actions { display: flex; gap: 6px; }
.editor-card__btn {
  height: 28px;
  padding: 0 12px;
  background: rgb(var(--v-theme-surface-light));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 4px;
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-family: var(--font-ui);
  font-size: 12px;
  letter-spacing: 0.01em;
  cursor: pointer;
  transition: all 0.15s;
}
.editor-card__btn:hover {
  border-color: rgba(var(--v-theme-primary), 0.45);
  color: rgb(var(--v-theme-on-surface));
}
.editor-card__btn.is-flash {
  background: rgba(var(--v-theme-primary), 0.15);
  border-color: rgba(var(--v-theme-primary), 0.55);
  color: rgb(var(--v-theme-on-surface));
}
.editor-card__btn--danger:hover {
  border-color: rgba(var(--v-theme-error, 198 81 78), 0.6);
  color: rgb(var(--v-theme-error, 198 81 78));
}

/* Editor empty */
.editor-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  background: rgb(var(--v-theme-surface));
  border: 1px dashed rgba(var(--v-theme-on-surface), 0.12);
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.55);
  text-align: center;
  gap: 10px;
  min-height: 16rem;
}
.editor-empty__icon { color: rgba(var(--v-theme-primary), 0.55); }
.editor-empty__title {
  margin: 4px 0 0;
  font-family: var(--font-display);
  font-size: 18px;
  font-style: italic;
  font-weight: 500;
  color: rgb(var(--v-theme-on-surface));
}
.editor-empty__hint {
  margin: 0 0 6px;
  font-family: var(--font-ui);
  font-size: 13px;
  max-width: 32rem;
  line-height: 1.5;
  color: rgba(var(--v-theme-on-surface), 0.5);
}
.editor-empty__cta {
  height: 30px;
  padding: 0 14px;
  background: rgba(var(--v-theme-primary), 0.12);
  border: 1px solid rgba(var(--v-theme-primary), 0.5);
  border-radius: 4px;
  color: rgb(var(--v-theme-on-surface));
  font-family: var(--font-ui);
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.15s;
}
.editor-empty__cta:hover {
  background: rgba(var(--v-theme-primary), 0.22);
  border-color: rgb(var(--v-theme-primary));
}

/* ========== Preview modal ========== */
.preview-card { background: rgb(var(--v-theme-surface)); }
.preview-card__title {
  display: flex;
  align-items: center;
  padding: 12px 16px 4px;
  font-family: var(--font-display);
  font-size: 18px;
}
.preview-card__topbar {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
  padding: 6px 22px 12px;
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.08);
}
.preview-card__topbar-label {
  font-family: var(--font-mono);
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface), 0.45);
}
.preview-card__topbar-sep {
  width: 1px;
  height: 18px;
  background: rgba(var(--v-theme-on-surface), 0.1);
  margin: 0 4px;
}
.preview-card__meta {
  font-family: var(--font-mono);
  font-size: 11.5px;
  color: rgba(var(--v-theme-on-surface), 0.7);
}
.preview-card__meta-label {
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-right: 4px;
  color: rgba(var(--v-theme-on-surface), 0.4);
}
.preview-card__meta--warn { color: rgb(var(--v-theme-error, 198 81 78)); }
.preview-card__body {
  padding: 12px 22px !important;
  max-height: 60vh;
}
.preview-card__json {
  margin: 0;
  padding: 14px 16px;
  background: rgb(var(--v-theme-surface-light));
  border: 1px solid rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  color: rgba(var(--v-theme-on-surface), 0.85);
}
.preview-card__foot {
  display: flex;
  align-items: center;
  padding: 6px 16px 12px;
  gap: 8px;
}
</style>
