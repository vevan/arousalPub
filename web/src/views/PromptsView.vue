<script setup lang="ts">
import AssembledMessagesPanel from '@/components/prompts/AssembledMessagesPanel.vue'
import GroupTargetPickerDialog from '@/components/GroupTargetPickerDialog.vue'
import {
  groupAllowsPromptEntries,
  usePromptsStore,
} from '@/stores/prompts'
import { promptGroupPickerItems } from '@/utils/entry-group-transfer'
import {
  bindingSlotUsesFlatSubBlockUi,
  bindingSlotUsesLegacyBundle,
  charCoreListInnerEntry,
  findCharCoreBundlePartner,
  findHistoryBundlePartner,
  historyListInnerEntry,
  isCharCoreListAnchor,
  isCharCoreListBundle,
  isHistoryListAnchor,
  isHistoryListBundle,
  legacyBundleDescKey,
  legacyBundleTitleKey,
  shouldHideCharSystemPromptInList,
  shouldHideHistoryPostHistoryInList,
} from '@/utils/system-binding-slots'
import { formatChatMessagesForDisplay } from '@/utils/format-prompt-json-display'
import {
  detectPromptImportKind,
  formatFilenameAsPresetName,
} from '@/utils/prompt-import'
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

const props = withDefaults(
  defineProps<{
    /** 在 App 模态内展示：放宽宽度并压缩依赖视口高度的区域 */
    embedded?: boolean
  }>(),
  { embedded: false },
)

const emit = defineEmits<{
  close: []
}>()

const store = usePromptsStore()
onMounted(() => {
  void store.loadEditorFromServer()
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
  activePrompts,
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
  void store.duplicatePreset(activePresetId.value)
}
function openDeletePreset() {
  if (presets.value.length <= 1) return
  presetDeleteOpen.value = true
}
function performDeletePreset() {
  void store.deletePreset(activePresetId.value)
  presetDeleteOpen.value = false
}
function switchPreset(id: string) {
  void store.selectPreset(id)
  presetSwitchOpen.value = false
}

/** ============== preset import / export ============== */
const importFileRef = ref<HTMLInputElement | null>(null)
const importErrorOpen = ref(false)
const importErrorMsg = ref('')
const stImportConfirmOpen = ref(false)
const stImportDoing = ref(false)
const stImportPendingParsed = ref<unknown>(null)
const stImportPreviewName = ref('')

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
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      throw new Error(
        `JSON 解析失败：${e instanceof Error ? e.message : String(e)}`,
      )
    }
    const kind = detectPromptImportKind(parsed)
    if (kind === 'native') {
      store.importPresetsFromJson(text)
      return
    }
    if (kind === 'st') {
      stImportPendingParsed.value = parsed
      stImportPreviewName.value = formatFilenameAsPresetName(file.name)
      stImportConfirmOpen.value = true
      return
    }
    throw new Error('文件中未找到有效的提示词预设或 SillyTavern 预设')
  } catch (e) {
    importErrorMsg.value = e instanceof Error ? e.message : String(e)
    importErrorOpen.value = true
  }
}

async function confirmStImport() {
  if (stImportPendingParsed.value == null) return
  stImportDoing.value = true
  try {
    await store.importStPresetFromJson(
      stImportPendingParsed.value,
      stImportPreviewName.value,
    )
    stImportConfirmOpen.value = false
    stImportPendingParsed.value = null
  } catch (e) {
    importErrorMsg.value = e instanceof Error ? e.message : String(e)
    importErrorOpen.value = true
  } finally {
    stImportDoing.value = false
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
function onCurrentGroupNameInput(e: Event) {
  const g = currentGroup.value
  if (!g) return
  store.updateGroup(g.id, {
    name: (e.target as HTMLInputElement).value,
  })
}
function onCurrentGroupDescriptionInput(e: Event) {
  const g = currentGroup.value
  if (!g) return
  store.updateGroup(g.id, {
    description: (e.target as HTMLInputElement).value,
  })
}
function isEntryMutedByGroup(p: PromptEntry): boolean {
  const g = activeGroups.value.find((x) => x.id === p.groupId)
  return g?.enabled === false && !p.bindingSlot
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

function onEntryDropAtRow(rowIdx: number) {
  onEntryDrop(rowDropTargetIndex(rowIdx))
}

function rowDropTargetIndex(rowIdx: number): number {
  const row = listRenderRows.value[rowIdx]
  if (!row) return rowIdx
  const anchorId = row.entry.id
  const i = visiblePrompts.value.findIndex((p) => p.id === anchorId)
  return i >= 0 ? i : rowIdx
}
function onEntryDragEnd() {
  entryDragId.value = null
  entryDragOverIdx.value = null
}

function selectEntry(id: string) {
  store.selectPrompt(id)
}

function onInnerSlotEnabledToggle(inner: PromptEntry) {
  store.updatePrompt(inner.id, { enabled: !inner.enabled })
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
const previewRawCopiedFlash = ref(false)
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

const previewFormattedJson = computed(() => {
  if (!previewResult.value?.messages.length) return ''
  return formatChatMessagesForDisplay(previewResult.value.messages)
})

async function copyPreviewFormatted() {
  if (!previewFormattedJson.value) return
  try {
    await navigator.clipboard.writeText(previewFormattedJson.value)
    previewCopiedFlash.value = true
    setTimeout(() => (previewCopiedFlash.value = false), 1200)
  } catch {
    /* ignore */
  }
}

async function copyPreviewJson() {
  if (!previewJson.value) return
  try {
    await navigator.clipboard.writeText(previewJson.value)
    previewRawCopiedFlash.value = true
    setTimeout(() => (previewRawCopiedFlash.value = false), 1200)
  } catch {
    /* ignore */
  }
}

/** ============== helpers ============== */
function groupBoundDescKey(kind: GroupKind): string {
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

function showHistoryTokenTrim(kind: GroupKind | undefined): boolean {
  return kind === 'history'
}

function groupBoundTitleKey(kind: GroupKind | undefined): string {
  switch (kind) {
    case 'character':
      return 'prompts.groupBoundTitleCharacter'
    case 'world':
      return 'prompts.groupBoundTitleWorld'
    case 'history':
      return 'prompts.groupBoundTitleHistory'
    case 'userInput':
      return 'prompts.groupBoundTitleUserInput'
    default:
      return 'prompts.groupBoundFromChat'
  }
}

function bindingSlotBundlePartsKey(slot: string | undefined): string | null {
  switch (slot) {
    case 'boundCharacterSystem':
      return 'prompts.boundCharacterSystemBundleParts'
    case 'boundUserPersona':
      return 'prompts.boundUserPersonaBundleParts'
    case 'boundCharSystemPrompt':
      return 'prompts.boundCharSystemPromptBundleParts'
    case 'boundCharDescription':
      return 'prompts.boundCharDescriptionBundleParts'
    case 'boundChatHistory':
      return 'prompts.boundChatHistoryBundleParts'
    case 'boundCharacterPostHistory':
      return 'prompts.boundCharacterPostHistoryBundleParts'
    default:
      return null
  }
}

function bindingSlotAllowsToggle(slot: string | undefined): boolean {
  return !bindingSlotIsRequired(slot)
}

function bindingSlotLabelKey(slot: string | undefined): string {
  switch (slot) {
    case 'boundCharacterSystem':
      return 'prompts.boundCharacterSystemLabel'
    case 'boundUserPersona':
      return 'prompts.boundUserPersonaLabel'
    case 'boundWorld':
      return 'prompts.boundWorldLabel'
    case 'boundWorldBefore':
      return 'prompts.boundWorldBeforeLabel'
    case 'boundWorldAfter':
      return 'prompts.boundWorldAfterLabel'
    case 'boundCharacterPostHistory':
      return 'prompts.boundCharacterPostHistoryLabel'
    case 'boundUserInput':
      return 'prompts.boundUserInputLabel'
    case 'boundMain':
      return 'prompts.boundMainLabel'
    case 'boundCharSystemPrompt':
      return 'prompts.boundCharSystemPromptLabel'
    case 'boundCharDescription':
      return 'prompts.boundCharDescriptionLabel'
    case 'boundCharPersonality':
      return 'prompts.boundCharPersonalityLabel'
    case 'boundScenario':
      return 'prompts.boundScenarioLabel'
    case 'boundEnhanceDefinitions':
      return 'prompts.boundEnhanceDefinitionsLabel'
    case 'boundDialogueExamples':
      return 'prompts.boundDialogueExamplesLabel'
    case 'boundNsfw':
      return 'prompts.boundNsfwLabel'
    case 'boundChatHistory':
      return 'prompts.boundChatHistoryLabel'
    default:
      return 'prompts.untitled'
  }
}

function bindingSlotIsRequired(slot: string | undefined): boolean {
  return (
    slot === 'boundWorld' ||
    slot === 'boundWorldBefore' ||
    slot === 'boundUserInput' ||
    slot === 'boundUserPersona'
  )
}


type PromptListRow =
  | {
      kind: 'legacy-bundle'
      entry: PromptEntry
      innerEntry: PromptEntry
      key: string
    }
  | { kind: 'entry'; entry: PromptEntry; key: string }

function promptsInGroup(groupId: string | undefined): PromptEntry[] {
  if (!groupId) return []
  return activePrompts.value.filter((e) => e.groupId === groupId)
}

const listBundleEditor = computed((): {
  block: PromptEntry
  slot: PromptEntry
} | null => {
  const s = selected.value
  if (!s?.bindingSlot) return null
  const inGroup = promptsInGroup(s.groupId)
  if (
    isCharCoreListAnchor(s) &&
    isCharCoreListBundle(s, inGroup)
  ) {
    const slot = findCharCoreBundlePartner(s, activePrompts.value)
    if (slot) return { block: s, slot }
  }
  if (s.bindingSlot === 'boundCharSystemPrompt') {
    const block = findCharCoreBundlePartner(s, activePrompts.value)
    if (block) return { block, slot: s }
  }
  if (
    isHistoryListAnchor(s) &&
    isHistoryListBundle(s, inGroup)
  ) {
    const slot = findHistoryBundlePartner(s, activePrompts.value)
    if (slot) return { block: s, slot }
  }
  if (s.bindingSlot === 'boundCharacterPostHistory') {
    const block = findHistoryBundlePartner(s, activePrompts.value)
    if (block) return { block, slot: s }
  }
  return null
})

function bindingSlotListHintKey(slot: string | undefined): string {
  switch (slot) {
    case 'boundCharacterSystem':
      return 'prompts.boundCharacterListHintSystem'
    case 'boundCharSystemPrompt':
      return 'prompts.boundCharSystemPromptListHint'
    case 'boundUserPersona':
      return 'prompts.boundUserPersonaListHint'
    case 'boundCharDescription':
      return 'prompts.boundCharDescriptionListHint'
    case 'boundCharPersonality':
      return 'prompts.boundCharPersonalityListHint'
    case 'boundScenario':
      return 'prompts.boundScenarioListHint'
    case 'boundWorld':
    case 'boundWorldBefore':
    case 'boundWorldAfter':
      return 'prompts.boundWorldListHint'
    case 'boundCharacterPostHistory':
      return 'prompts.boundCharacterListHintPost'
    case 'boundChatHistory':
      return 'prompts.boundChatHistoryListHint'
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
    case 'boundCharSystemPrompt':
      return 'prompts.boundCharSystemPromptEditorDesc'
    case 'boundUserPersona':
      return 'prompts.boundUserPersonaEditorDesc'
    case 'boundCharDescription':
      return 'prompts.boundCharDescriptionEditorDesc'
    case 'boundCharPersonality':
      return 'prompts.boundCharPersonalityEditorDesc'
    case 'boundScenario':
      return 'prompts.boundScenarioEditorDesc'
    case 'boundWorld':
    case 'boundWorldBefore':
    case 'boundWorldAfter':
      return 'prompts.boundWorldEditorDesc'
    case 'boundCharacterPostHistory':
      return 'prompts.boundCharacterEditorDescPost'
    case 'boundChatHistory':
      return 'prompts.boundChatHistoryEditorDesc'
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

function entryGroupKind(p: PromptEntry): GroupKind | undefined {
  return activeGroups.value.find((g) => g.id === p.groupId)?.kind
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

const listRenderRows = computed((): PromptListRow[] => {
  const rows: PromptListRow[] = []
  const prompts = visiblePrompts.value
  const groupKind = currentGroup.value?.kind
  const groupId = currentGroup.value?.id
  const groupPrompts = groupId
    ? activePrompts.value.filter((e) => e.groupId === groupId)
    : []
  for (let i = 0; i < prompts.length; i++) {
    const p = prompts[i]
    if (shouldHideCharSystemPromptInList(p, groupPrompts)) continue
    if (shouldHideHistoryPostHistoryInList(p, groupPrompts)) continue

    if (bindingSlotUsesLegacyBundle(p.bindingSlot, groupKind, groupPrompts)) {
      const inner =
        charCoreListInnerEntry(p, groupPrompts) ??
        historyListInnerEntry(p, groupPrompts) ??
        p
      rows.push({
        kind: 'legacy-bundle',
        entry: p,
        innerEntry: inner,
        key: p.id,
      })
      continue
    }

    rows.push({ kind: 'entry', entry: p, key: p.id })
  }
  return rows
})

const currentGroupCustomMuted = computed({
  get: () => currentGroup.value?.enabled === false,
  set: (muted: boolean) => {
    const g = currentGroup.value
    if (!g) return
    store.updateGroup(g.id, { enabled: !muted })
  },
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
    :class="{ 'prompts-view--embedded': props.embedded }"
  >
    <div
      class="prompts-view__inner"
      :class="props.embedded ? 'prompts-view__inner--embedded' : 'app-page-shell'"
    >
      <!-- ============ Head ============ -->
      <header
        class="library-page-head"
        :class="{ 'library-page-head--with-close': props.embedded }"
      >
        <div class="library-page-head__row">
          <h1 class="library-page-head__title">
            {{ $t('prompts.pageTitle') }}
          </h1>
          <div class="library-page-head__aside">
            <p class="library-page-head__lede">
              {{ $t('prompts.lede') }}
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
          <p class="preset-bar__count">
            {{ $t('prompts.count', { n: activePreset.prompts.length }) }}
          </p>
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
              'is-custom-muted': g.enabled === false,
              'is-dragging': groupDragId === g.id,
            }"
            draggable="true"
            @click="selectGroup(g)"
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

      <!-- ============ Group info (current group) ============ -->
      <section
        v-if="currentGroup"
        class="groups-info"
        :aria-label="$t('prompts.groupInfoLabel')"
      >
        <div class="groups-info__row">
          <v-icon size="16" class="groups-info__icon">
            {{ groupIcon(currentGroup.kind) }}
          </v-icon>
          <input
            :value="currentGroup.name"
            type="text"
            class="groups-info__name"
            :aria-label="$t('prompts.groupAddName')"
            @input="onCurrentGroupNameInput"
          />
          <input
            :value="currentGroup.description ?? ''"
            type="text"
            class="groups-info__description"
            :aria-label="$t('prompts.groupDescription')"
            :placeholder="$t('prompts.groupDescriptionPlaceholder')"
            @input="onCurrentGroupDescriptionInput"
          />
          <v-tooltip
            location="top"
            :text="$t('prompts.groupDisableCustomEntriesTooltip')"
          >
            <template #activator="{ props: tipProps }">
              <v-switch
                v-bind="tipProps"
                v-model="currentGroupCustomMuted"
                class="groups-info__switch"
                color="primary"
                density="compact"
                hide-details
              >
                <template #label>
                  <span class="groups-info__switch-label">
                    {{ $t('prompts.groupDisableCustomEntries') }}
                  </span>
                </template>
              </v-switch>
            </template>
          </v-tooltip>
        </div>
      </section>

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

            <template v-for="(row, rowIdx) in listRenderRows" :key="row.key">
              <span
                v-if="entryDragOverIdx === rowIdx && isEntryListGroup"
                class="entry-drop-indicator"
              />
              <div
                v-if="row.kind === 'legacy-bundle'"
                class="character-system-bundle"
                :class="{
                  'is-active':
                    selected?.id === row.entry.id ||
                    selected?.id === row.innerEntry.id,
                  'is-disabled': isEntryMutedByGroup(row.entry),
                  'is-dragging':
                    entryDragId === row.entry.id ||
                    entryDragId === row.innerEntry.id,
                }"
                tabindex="0"
                draggable="true"
                @click="selectEntry(row.entry.id)"
                @keydown.enter="selectEntry(row.entry.id)"
                @dragstart="onEntryDragStart(row.entry.id, $event)"
                @dragover="onEntryDragOver(rowIdx, $event)"
                @drop="onEntryDropAtRow(rowIdx)"
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
                    {{ groupIcon(currentGroup!.kind) }}
                  </v-icon>
                  <div class="character-system-bundle__title">
                    {{ $t(legacyBundleTitleKey(row.entry.bindingSlot, currentGroup?.kind)) }}
                  </div>
                  <div class="character-system-bundle__desc group-bound-desc">
                    <p>
                      {{ $t(legacyBundleDescKey(row.entry.bindingSlot, currentGroup?.kind)) }}
                    </p>
                    <p
                      v-if="
                        row.entry.bindingSlot === 'boundChatHistory' &&
                        showHistoryTokenTrim(currentGroup?.kind)
                      "
                    >
                      {{ $t('prompts.groupBoundHistoryTokenTrim') }}
                    </p>
                    <p class="group-bound-desc__drag">
                      {{ $t('prompts.groupBoundDragHint') }}
                    </p>
                  </div>
                </div>
                <article
                  class="entry-card entry-card--in-character-bundle"
                  :class="{
                    'is-active': selected?.id === row.innerEntry.id,
                    'is-disabled': !row.innerEntry.enabled,
                  }"
                  draggable="false"
                  @click.stop="selectEntry(row.innerEntry.id)"
                >
                  <div class="entry-card__row">
                    <button
                      v-if="bindingSlotAllowsToggle(row.innerEntry.bindingSlot)"
                      type="button"
                      class="entry-card__enabled"
                      :class="{ 'is-on': row.innerEntry.enabled }"
                      :aria-pressed="row.innerEntry.enabled"
                      :title="$t('prompts.fieldEnabled')"
                      @click.stop="
                        onInnerSlotEnabledToggle(row.innerEntry)
                      "
                    >
                      <span class="entry-card__enabled-dot" />
                    </button>
                    <h2 class="entry-card__title entry-card__title--bundle-inner">
                      {{ $t(bindingSlotLabelKey(row.innerEntry.bindingSlot)) }}
                    </h2>
                    <span class="entry-card__binding">{{ $t('prompts.bindingSlotTag') }}</span>
                  </div>
                  <div class="entry-card__meta entry-card__meta--binding">
                    <span
                      v-if="bindingSlotBundlePartsKey(row.innerEntry.bindingSlot)"
                      class="entry-card__bundle-parts"
                    >
                      {{ $t(bindingSlotBundlePartsKey(row.innerEntry.bindingSlot)!) }}
                    </span>
                    <span class="entry-card__pos">{{ $t('prompts.positionRelative') }}</span>
                  </div>
                </article>
              </div>
              <article
                v-else
                class="entry-card"
                :class="{
                  'is-active': selected?.id === row.entry.id,
                  'is-disabled': !row.entry.enabled || isEntryMutedByGroup(row.entry),
                  'is-dragging': entryDragId === row.entry.id,
                }"
                tabindex="0"
                draggable="true"
                @click="selectEntry(row.entry.id)"
                @keydown.enter="selectEntry(row.entry.id)"
                @dragstart="onEntryDragStart(row.entry.id, $event)"
                @dragover="onEntryDragOver(rowIdx, $event)"
                @drop="onEntryDropAtRow(rowIdx)"
                @dragend="onEntryDragEnd"
              >
                <div class="entry-card__row">
                  <v-icon size="14" class="entry-card__handle" :title="$t('prompts.dragHandle')">
                    mdi-drag-vertical
                  </v-icon>
                  <button
                    v-if="!row.entry.bindingSlot || bindingSlotAllowsToggle(row.entry.bindingSlot)"
                    type="button"
                    class="entry-card__enabled"
                    :class="{ 'is-on': row.entry.enabled }"
                    :aria-pressed="row.entry.enabled"
                    :title="$t('prompts.fieldEnabled')"
                    @click.stop="store.updatePrompt(row.entry.id, { enabled: !row.entry.enabled })"
                  >
                    <span class="entry-card__enabled-dot" />
                  </button>
                  <h2 class="entry-card__title">
                    <template v-if="row.entry.bindingSlot">{{
                      $t(bindingSlotLabelKey(row.entry.bindingSlot))
                    }}</template>
                    <template v-else>{{ row.entry.title || $t('prompts.untitled') }}</template>
                  </h2>
                  <span
                    v-if="row.entry.bindingSlot"
                    class="entry-card__binding"
                  >{{ $t('prompts.bindingSlotTag') }}</span>
                  <span
                    v-else-if="row.entry.isSeed"
                    class="entry-card__seed"
                  >{{ $t('prompts.seedTag') }}</span>
                </div>
                <p
                  v-if="!row.entry.bindingSlot && (row.entry.description || row.entry.content)"
                  class="entry-card__body"
                >{{ previewBody(row.entry) }}</p>
                <div v-if="!row.entry.bindingSlot" class="entry-card__meta">
                  <span class="entry-card__role-chip" :class="`role-${row.entry.role}`">
                    {{ $t(`prompts.role${row.entry.role.charAt(0).toUpperCase() + row.entry.role.slice(1)}`) }}
                  </span>
                  <span
                    class="entry-card__pos"
                    :class="{ 'is-chat': row.entry.injectionPosition === 'chat' }"
                  >
                    {{ row.entry.injectionPosition === 'relative'
                      ? $t('prompts.positionRelative')
                      : `${$t('prompts.positionChat')} · ${$t('prompts.fieldDepth')} ${row.entry.injectionDepth}` }}
                  </span>
                  <span
                    v-if="row.entry.triggers.length"
                    class="entry-card__trigs"
                  >
                    {{ row.entry.triggers.map((t) => $t(`prompts.trigger${t.charAt(0).toUpperCase() + t.slice(1)}`)).join(' · ') }}
                  </span>
                </div>
                <div v-else class="entry-card__meta entry-card__meta--binding">
                  <span class="entry-card__pos">{{ $t('prompts.positionRelative') }}</span>
                </div>
              </article>
            </template>
            <span
              v-if="entryDragOverIdx === listRenderRows.length && isEntryListGroup"
              class="entry-drop-indicator"
            />

            <div
              v-if="isEntryListGroup && listRenderRows.length === 0"
              class="prompts-empty"
            >
              <div class="prompts-empty__title">{{ $t('prompts.emptyTitle') }}</div>
              <div class="prompts-empty__hint">{{ $t('prompts.emptyHint') }}</div>
            </div>
          </div>
        </aside>

        <!-- ====== Right editor ====== -->
        <section class="prompts-editor">
          <template v-if="listBundleEditor">
            <div class="editor-card editor-card--binding">
              <section class="binding-editor__block">
                <header class="binding-editor__section-head">
                  <h2 class="binding-editor__block-title">
                    {{ $t(legacyBundleTitleKey(listBundleEditor.block.bindingSlot, entryGroupKind(listBundleEditor.block))) }}
                  </h2>
                  <span class="binding-editor__section-tag">
                    {{ $t('prompts.bindingEditorBlockTag') }}
                  </span>
                </header>
                <div class="binding-editor__section-body group-bound-desc">
                  <p>
                    {{ $t(legacyBundleDescKey(listBundleEditor.block.bindingSlot, entryGroupKind(listBundleEditor.block))) }}
                  </p>
                  <p
                    v-if="showHistoryTokenTrim(entryGroupKind(listBundleEditor.block))"
                  >
                    {{ $t('prompts.groupBoundHistoryTokenTrim') }}
                  </p>
                  <p class="group-bound-desc__drag">
                    {{ $t('prompts.groupBoundDragHint') }}
                  </p>
                </div>
              </section>

              <section class="binding-editor__slot">
                <header
                  class="binding-editor__section-head binding-editor__section-head--slot"
                >
                  <button
                    v-if="bindingSlotAllowsToggle(listBundleEditor.slot.bindingSlot)"
                    type="button"
                    class="editor-card__enabled"
                    :class="{ 'is-on': listBundleEditor.slot.enabled }"
                    :aria-pressed="listBundleEditor.slot.enabled"
                    :title="$t('prompts.fieldEnabled')"
                    :aria-label="$t('prompts.fieldEnabled')"
                    @click="onInnerSlotEnabledToggle(listBundleEditor.slot)"
                  >
                    <span class="editor-card__enabled-track" />
                    <span class="editor-card__enabled-thumb" />
                  </button>
                  <h3 class="binding-editor__slot-title">
                    {{ $t(bindingSlotLabelKey(listBundleEditor.slot.bindingSlot)) }}
                  </h3>
                  <span class="binding-editor__section-tag">
                    {{ $t('prompts.bindingEditorSlotTag') }}
                  </span>
                </header>
                <div class="binding-editor__section-body">
                  <p>{{ $t(bindingSlotListHintKey(listBundleEditor.slot.bindingSlot)) }}</p>
                  <p>{{ $t(bindingSlotEditorDescKey(listBundleEditor.slot.bindingSlot)) }}</p>
                </div>
              </section>

              <footer class="editor-card__foot">
                <span class="editor-card__autosave">{{ $t('prompts.autosaveHint') }}</span>
              </footer>
            </div>
          </template>

          <template v-else-if="selected?.bindingSlot && bindingSlotUsesFlatSubBlockUi(selected.bindingSlot, entryGroupKind(selected), promptsInGroup(selected.groupId))">
            <div class="editor-card editor-card--binding">
              <section class="binding-editor__slot binding-editor__slot--standalone">
                <header
                  class="binding-editor__section-head binding-editor__section-head--slot"
                >
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
                  <h2 class="binding-editor__slot-title binding-editor__slot-title--standalone">
                    {{ $t(bindingSlotLabelKey(selected.bindingSlot)) }}
                  </h2>
                  <span class="binding-editor__section-tag">
                    {{ $t('prompts.bindingEditorSlotTag') }}
                  </span>
                </header>
                <div class="binding-editor__section-body">
                  <p>{{ $t(bindingSlotListHintKey(selected.bindingSlot)) }}</p>
                  <p>{{ $t(bindingSlotEditorDescKey(selected.bindingSlot)) }}</p>
                </div>
              </section>
              <footer class="editor-card__foot">
                <span class="editor-card__autosave">{{ $t('prompts.autosaveHint') }}</span>
              </footer>
            </div>
          </template>

          <template v-else-if="selected?.bindingSlot">
            <div class="editor-card editor-card--binding">
              <section class="binding-editor__block">
                <header class="binding-editor__section-head">
                  <h2 class="binding-editor__block-title">
                    {{ $t(legacyBundleTitleKey(selected.bindingSlot, entryGroupKind(selected))) }}
                  </h2>
                  <span class="binding-editor__section-tag">
                    {{ $t('prompts.bindingEditorBlockTag') }}
                  </span>
                </header>
                <div class="binding-editor__section-body group-bound-desc">
                  <p>
                    {{ $t(legacyBundleDescKey(selected.bindingSlot, entryGroupKind(selected))) }}
                  </p>
                  <p
                    v-if="
                      selected.bindingSlot === 'boundCharacterPostHistory' &&
                      showHistoryTokenTrim(entryGroupKind(selected))
                    "
                  >
                    {{ $t('prompts.groupBoundHistoryTokenTrim') }}
                  </p>
                  <p class="group-bound-desc__drag">
                    {{ $t('prompts.groupBoundDragHint') }}
                  </p>
                </div>
              </section>

              <section class="binding-editor__slot">
                <header
                  class="binding-editor__section-head binding-editor__section-head--slot"
                >
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
                  <h3 class="binding-editor__slot-title">
                    {{ $t(bindingSlotLabelKey(selected.bindingSlot)) }}
                  </h3>
                  <span class="binding-editor__section-tag">
                    {{ $t('prompts.bindingEditorSlotTag') }}
                  </span>
                </header>
                <div class="binding-editor__section-body">
                  <p>{{ $t(bindingSlotListHintKey(selected.bindingSlot)) }}</p>
                  <p>{{ $t(bindingSlotEditorDescKey(selected.bindingSlot)) }}</p>
                </div>
              </section>

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
                  ? $t(groupBoundTitleKey(currentGroup.kind))
                  : $t('prompts.editorEmptyTitle') }}
              </h2>
              <p
                v-if="currentGroup && !isEntryListGroup"
                class="editor-empty__hint group-bound-desc"
              >
                <span class="group-bound-desc__line">{{
                  $t(groupBoundDescKey(currentGroup.kind))
                }}</span>
                <span
                  v-if="showHistoryTokenTrim(currentGroup.kind)"
                  class="group-bound-desc__line"
                >{{ $t('prompts.groupBoundHistoryTokenTrim') }}</span>
                <span class="group-bound-desc__line group-bound-desc__drag">{{
                  $t('prompts.groupBoundDragHint')
                }}</span>
              </p>
              <p v-else class="editor-empty__hint">
                {{ $t('prompts.editorEmptyHint') }}
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

    <v-dialog v-model="stImportConfirmOpen" max-width="32rem">
      <v-card>
        <v-card-title class="text-subtitle-1">
          {{ $t('prompts.stImportConfirmTitle') }}
        </v-card-title>
        <v-card-text class="text-body-2">
          <p class="mb-2">{{ $t('prompts.stImportConfirmLead') }}</p>
          <ul class="pl-4 mb-3">
            <li>{{ $t('prompts.stImportConfirmBulletOrder') }}</li>
            <li>{{ $t('prompts.stImportConfirmBulletEnabled') }}</li>
            <li>{{ $t('prompts.stImportConfirmBulletEdit') }}</li>
          </ul>
          <p class="mb-0">
            {{ $t('prompts.stImportConfirmName', { name: stImportPreviewName }) }}
          </p>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn
            variant="text"
            :disabled="stImportDoing"
            @click="stImportConfirmOpen = false"
          >
            {{ $t('settings.themeCancel') }}
          </v-btn>
          <v-btn
            color="primary"
            variant="flat"
            :loading="stImportDoing"
            @click="confirmStImport"
          >
            {{ $t('prompts.stImportConfirmAction') }}
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
          <AssembledMessagesPanel
            v-else-if="previewResult?.messages.length"
            :messages="previewResult.messages"
          />
        </v-card-text>
        <v-card-actions class="preview-card__foot">
          <v-spacer />
          <button
            type="button"
            class="editor-card__btn"
            :class="{ 'is-flash': previewCopiedFlash }"
            @click="copyPreviewFormatted"
          >{{ previewCopiedFlash ? $t('prompts.previewCopied') : $t('prompts.previewCopy') }}</button>
          <button
            type="button"
            class="editor-card__btn"
            :class="{ 'is-flash': previewRawCopiedFlash }"
            @click="copyPreviewJson"
          >{{ previewRawCopiedFlash ? $t('prompts.previewCopied') : $t('prompts.previewCopyRaw') }}</button>
          <v-btn variant="text" @click="previewOpen = false">{{ $t('prompts.previewClose') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Shared with LorebooksView — see @/styles/prompts-library.css */
</style>
