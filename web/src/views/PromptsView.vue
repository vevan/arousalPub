<script setup lang="ts">
import PromptsDialogs from '@/components/prompts/PromptsDialogs.vue'
import PromptsEntryEditor from '@/components/prompts/PromptsEntryEditor.vue'
import PromptsListPanel from '@/components/prompts/PromptsListPanel.vue'
import { groupIcon } from '@/components/prompts/prompt-entry-ui'
import {
  groupAllowsPromptEntries,
  usePromptsStore,
  type PromptGroup,
} from '@/stores/prompts'
import {
  detectPromptImportKind,
  formatFilenameAsPresetName,
} from '@/utils/prompt-import'
import { useNarrowLayout } from '@/composables/use-narrow-layout'
import { useUiContextStore } from '@/stores/ui-context'
import { coreNotify } from '@/utils/core-notify'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

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
const uiContext = useUiContextStore()

const dialogsRef = ref<InstanceType<typeof PromptsDialogs> | null>(null)
const editorRef = ref<InstanceType<typeof PromptsEntryEditor> | null>(null)

async function runPendingImportPick() {
  if (!uiContext.consumePendingPromptsAutoImport()) return
  await nextTick()
  performImportPickFile()
}

onMounted(() => {
  if (!props.embedded) {
    void store.applyOpenFocus(null, null)
  }
  void runPendingImportPick()
  window.addEventListener('keydown', onMultiSelectKeydown)
})

watch(
  () => uiContext.openPromptsImportSignal,
  () => {
    void runPendingImportPick()
  },
)

const {
  presets,
  activePresetId,
  editingPresetId,
  isEditingPresetDefault,
  activePreset,
  activeGroups,
  activeGroupId,
  groupCounts,
  multiSelectMode,
} = storeToRefs(store)

const { isNarrow } = useNarrowLayout()
const mobileMasterDetail = computed(() => props.embedded && isNarrow.value)

const presetSwitchOpen = ref(false)
const setDefaultPresetLoading = ref(false)

function switchPreset(id: string) {
  void (async () => {
    const ok = await store.selectPreset(id)
    if (!ok) {
      coreNotify(
        store.lastError?.trim() || t('prompts.presetSwitchFailed'),
        undefined,
        { level: 'error' },
      )
      return
    }
    presetSwitchOpen.value = false
  })()
}

async function onSetDefaultPreset() {
  if (isEditingPresetDefault.value) return
  setDefaultPresetLoading.value = true
  try {
    await store.setGlobalDefaultPreset()
    coreNotify(t('prompts.setDefaultPresetOk'), undefined, { level: 'success' })
  } catch (e) {
    coreNotify(e instanceof Error ? e.message : String(e), undefined, {
      level: 'error',
    })
  } finally {
    setDefaultPresetLoading.value = false
  }
}

function performDuplicatePreset() {
  void store.duplicatePreset(editingPresetId.value)
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
const groupNameDraft = ref('')
const groupDescDraft = ref('')

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

function commitGroupDrafts(groupId?: string): void {
  const id = groupId ?? activeGroupId.value
  if (!id) return
  const g = activeGroups.value.find((x) => x.id === id)
  if (!g) return
  const patch: { name?: string; description?: string } = {}
  if (groupNameDraft.value !== g.name) patch.name = groupNameDraft.value
  if (groupDescDraft.value !== (g.description ?? '')) {
    patch.description = groupDescDraft.value
  }
  if (Object.keys(patch).length > 0) store.updateGroup(id, patch)
}
function syncGroupDrafts(): void {
  const id = activeGroupId.value
  const g = id
    ? (activeGroups.value.find((x) => x.id === id) ?? null)
    : null
  if (!g) {
    groupNameDraft.value = ''
    groupDescDraft.value = ''
    return
  }
  groupNameDraft.value = g.name
  groupDescDraft.value = g.description ?? ''
}

function selectGroup(g: PromptGroup) {
  store.selectGroup(g.id)
}

const isPlaceholderGroup = (g: PromptGroup) =>
  g.kind === 'character' ||
  g.kind === 'world' ||
  g.kind === 'history' ||
  g.kind === 'userInput'

const canDeleteGroup = (g: PromptGroup) =>
  g.kind === 'normal' && !isPlaceholderGroup(g)

function openDeleteGroup(g: PromptGroup) {
  if (!canDeleteGroup(g)) return
  dialogsRef.value?.openDeleteGroup(g)
}

const currentGroup = computed<PromptGroup | null>(() => {
  if (!activeGroupId.value) return null
  return activeGroups.value.find((g) => g.id === activeGroupId.value) ?? null
})

const currentGroupCustomMuted = computed({
  get: () => currentGroup.value?.enabled === false,
  set: (muted: boolean) => {
    const g = currentGroup.value
    if (!g) return
    store.updateGroup(g.id, { enabled: !muted })
  },
})

watch(activeGroupId, (id, prevId) => {
  if (prevId != null && prevId !== id) {
    commitGroupDrafts(prevId)
  }
  syncGroupDrafts()
}, { immediate: true })

watch(
  editingPresetId,
  () => {
    if (!activeGroupId.value) {
      const firstNormal = activeGroups.value.find((g) => g.kind === 'normal')
      if (firstNormal) store.selectGroup(firstNormal.id)
    }
  },
  { immediate: true },
)

function createEntry() {
  const gid = activeGroupId.value
  if (!gid) return
  const g = activeGroups.value.find((x) => x.id === gid)
  if (!g || !groupAllowsPromptEntries(g.kind)) return
  store.createPrompt(gid)
  void nextTick(() => editorRef.value?.focusTitle())
}

function onListBatchTransfer(mode: 'copy' | 'move') {
  dialogsRef.value?.openBatchTransfer(mode)
}

function onEditorBatchTransfer(mode: 'copy' | 'move') {
  dialogsRef.value?.openEntryTransfer(mode)
}

function onDeleteEntry() {
  dialogsRef.value?.confirmDeleteEntry()
}

function onMultiSelectKeydown(evt: KeyboardEvent) {
  if (evt.key !== 'Escape' || !multiSelectMode.value) return
  if (dialogsRef.value?.blockingEscape) return
  store.exitMultiSelect()
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onMultiSelectKeydown)
  const gid = activeGroupId.value
  if (gid) commitGroupDrafts(gid)
})
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
                <v-tooltip
                  location="top start"
                  :text="activePreset.name"
                >
                  <template #activator="{ props: tipProps }">
                    <span
                      v-bind="tipProps"
                      class="preset-bar__current-name d-inline-flex align-center ga-1"
                    >
                      <v-icon
                        v-if="isEditingPresetDefault"
                        size="14"
                        color="primary"
                        class="flex-shrink-0"
                        :title="$t('prompts.defaultPresetMark')"
                        :aria-label="$t('prompts.defaultPresetMark')"
                      >
                        mdi-heart
                      </v-icon>
                      <span class="preset-bar__current-name-text">{{ activePreset.name }}</span>
                    </span>
                  </template>
                </v-tooltip>
                <v-icon size="14" class="preset-bar__caret">mdi-chevron-down</v-icon>
              </button>
            </template>
            <v-list density="compact" min-width="200">
              <v-list-item
                v-for="p in presets"
                :key="p.id"
                :active="p.id === editingPresetId"
                @click="switchPreset(p.id)"
              >
                <v-list-item-title class="preset-dropdown-title">
                  <span class="preset-dropdown-mark" aria-hidden="true">
                    <v-icon
                      v-if="p.id === activePresetId"
                      size="16"
                      color="primary"
                      :title="$t('prompts.defaultPresetMark')"
                      :aria-label="$t('prompts.defaultPresetMark')"
                    >
                      mdi-heart
                    </v-icon>
                  </span>
                  <span>{{ p.name }}</span>
                </v-list-item-title>
              </v-list-item>
            </v-list>
          </v-menu>
          <button
            type="button"
            class="preset-bar__default-btn"
            :disabled="isEditingPresetDefault || setDefaultPresetLoading"
            :title="
              isEditingPresetDefault
                ? $t('prompts.setDefaultPresetAlready')
                : undefined
            "
            @click="onSetDefaultPreset"
          >
            {{ $t('prompts.setDefaultPreset') }}
          </button>
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('prompts.presetNew')"
            :aria-label="$t('prompts.presetNew')"
            @click="dialogsRef?.openCreatePreset()"
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
            @click="dialogsRef?.openRenamePreset()"
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
            @click="dialogsRef?.openDeletePreset()"
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
            @click="dialogsRef?.openPreview()"
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
          @click="dialogsRef?.openAddGroup()"
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
            v-model="groupNameDraft"
            type="text"
            class="groups-info__name"
            :aria-label="$t('prompts.groupAddName')"
            @blur="commitGroupDrafts()"
          />
          <input
            v-model="groupDescDraft"
            type="text"
            class="groups-info__description"
            :aria-label="$t('prompts.groupDescription')"
            :placeholder="$t('prompts.groupDescriptionPlaceholder')"
            @blur="commitGroupDrafts()"
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
        <PromptsListPanel
          @batch-transfer="onListBatchTransfer"
          @create-entry="createEntry"
        />
        <PromptsEntryEditor
          ref="editorRef"
          :embedded="props.embedded"
          @batch-transfer="onEditorBatchTransfer"
          @delete-entry="onDeleteEntry"
          @create-entry="createEntry"
        />
      </div>
    </div>

    <PromptsDialogs
      ref="dialogsRef"
      v-model:import-error-open="importErrorOpen"
      v-model:st-import-confirm-open="stImportConfirmOpen"
      :import-error-msg="importErrorMsg"
      :st-import-doing="stImportDoing"
      :st-import-preview-name="stImportPreviewName"
      @confirm-st-import="confirmStImport"
    />
  </div>
</template>

<style scoped>
/* Shared with LorebooksView — see @/styles/prompts-library.css */
</style>
