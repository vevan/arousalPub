<script setup lang="ts">
import LorebooksDialogs from '@/components/lorebooks/LorebooksDialogs.vue'
import LorebooksEntryEditor from '@/components/lorebooks/LorebooksEntryEditor.vue'
import LorebooksListPanel from '@/components/lorebooks/LorebooksListPanel.vue'
import HybridFtsAssetSettings from '@/components/settings/HybridFtsAssetSettings.vue'
import { usePreferencesStore } from '@/stores/preferences'
import { useLorebooksStore, type LorebookEntry } from '@/stores/lorebooks'
import { coreNotify } from '@/utils/core-notify'
import { resolveEntryTriggerMode } from '@/utils/lorebook-entry'
import {
  formatHybridFtsSpec,
  resolveEffectiveHybridFtsSettings,
  type HybridFtsSettings,
} from '@/utils/hybrid-fts-settings'
import { parseLorebookImport } from '@/utils/lorebooks-package'
import { useNarrowLayout } from '@/composables/use-narrow-layout'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = withDefaults(
  defineProps<{ embedded?: boolean }>(),
  { embedded: false },
)

const emit = defineEmits<{
  close: []
}>()

const store = useLorebooksStore()
const preferencesStore = usePreferencesStore()
const { t } = useI18n()
const { hybridFtsProfile, hybridFtsDictVariant } = storeToRefs(preferencesStore)

const {
  lorebooks,
  activeLorebookId,
  activeGroupId,
  activeLorebook,
  activeGroups,
  groupCounts,
  loading,
  saving,
  lastError,
  multiSelectMode,
} = storeToRefs(store)

const { isNarrow } = useNarrowLayout()
const mobileMasterDetail = computed(() => props.embedded && isNarrow.value)

const dialogsRef = ref<InstanceType<typeof LorebooksDialogs> | null>(null)
const editorRef = ref<InstanceType<typeof LorebooksEntryEditor> | null>(null)

const lorebookSwitchOpen = ref(false)
const hybridFtsDialogOpen = ref(false)
const hybridFtsSaving = ref(false)
const hybridFtsRebuilding = ref(false)
const globalHybridFts = computed<HybridFtsSettings>(() => ({
  profile: hybridFtsProfile.value,
  dictVariant: hybridFtsDictVariant.value,
}))

function lorebookEffectiveHybridFts(lb: {
  hybridFts?: HybridFtsSettings | null
}): HybridFtsSettings {
  return resolveEffectiveHybridFtsSettings(
    globalHybridFts.value,
    lb.hybridFts ?? null,
  )
}

/** 无向量条目时不存在索引，重建也只会删空，故不算过期 */
function lorebookHasVectorEntries(lb: { entries?: LorebookEntry[] }): boolean {
  return (lb.entries ?? []).some(
    (e) =>
      e.enabled &&
      resolveEntryTriggerMode(e) === 'vector' &&
      (e.title.trim().length > 0 || e.content.trim().length > 0),
  )
}

/** 按 built 戳记与当前生效配置实时比对；勿依赖加载时的 hybridFtsStale 快照 */
function lorebookIsHybridFtsStale(lb: {
  entries?: LorebookEntry[]
  hybridFts?: HybridFtsSettings | null
  builtHybridFtsSpec?: string | null
}): boolean {
  if (!lorebookHasVectorEntries(lb)) return false
  const built = lb.builtHybridFtsSpec?.trim() || ''
  return !built || built !== formatHybridFtsSpec(lorebookEffectiveHybridFts(lb))
}

function lorebookShowsHybridFtsStale(lb: {
  id?: string
  entries?: LorebookEntry[]
  hybridFts?: HybridFtsSettings | null
  builtHybridFtsSpec?: string | null
}): boolean {
  // PATCH 乐观清 override 后、重建回写 builtSpec 前，勿闪「需要重建」
  if (
    lb.id === activeLorebookId.value &&
    (hybridFtsSaving.value ||
      hybridFtsRebuilding.value ||
      store.hybridFtsMutating)
  ) {
    return false
  }
  return lorebookIsHybridFtsStale(lb)
}

const hybridFtsStale = computed(
  () =>
    Boolean(activeLorebook.value.id) &&
    lorebookShowsHybridFtsStale(activeLorebook.value),
)

const activeLorebookHasVectorEntries = computed(() =>
  lorebookHasVectorEntries(activeLorebook.value),
)

function switchLorebook(id: string) {
  store.selectLorebook(id)
  lorebookSwitchOpen.value = false
}

async function refreshActiveLorebookHybridFts(): Promise<void> {
  const id = activeLorebookId.value
  if (!id) return
  const res = await fetch(`/api/lorebooks/${encodeURIComponent(id)}`)
  if (!res.ok) return
  const lorebook = (await res.json()) as {
    hybridFts?: HybridFtsSettings | null
    builtHybridFtsSpec?: string | null
    hybridFtsStale?: boolean
  }
  store.applyLorebookHybridFtsStatus(id, {
    hybridFts: lorebook.hybridFts ?? null,
    builtHybridFtsSpec: lorebook.builtHybridFtsSpec ?? null,
    hybridFtsStale: lorebook.hybridFtsStale ?? false,
  })
}

async function rebuildActiveLorebook(): Promise<void> {
  const id = activeLorebookId.value
  if (!id || hybridFtsRebuilding.value) return
  hybridFtsRebuilding.value = true
  try {
    await store.flushSave()
    const res = await fetch(
      `/api/lorebooks/${encodeURIComponent(id)}/reindex`,
      { method: 'POST' },
    )
    if (!res.ok) {
      const detail = await res.text()
      throw new Error(detail.slice(0, 300))
    }
    await refreshActiveLorebookHybridFts()
    coreNotify(
      activeLorebookHasVectorEntries.value
        ? t('lorebooks.hybridFtsRebuildOk')
        : t('lorebooks.hybridFtsRebuildSkippedNoVector'),
      undefined,
      { level: 'success' },
    )
  } catch (e) {
    coreNotify(
      t('lorebooks.hybridFtsRebuildFailed'),
      e instanceof Error ? e.message : undefined,
      { level: 'error' },
    )
  } finally {
    hybridFtsRebuilding.value = false
  }
}

async function changeActiveHybridFts(
  value: HybridFtsSettings | null,
): Promise<void> {
  const id = activeLorebookId.value
  if (!id) return
  hybridFtsSaving.value = true
  try {
    await store.patchLorebookHybridFts(id, value)
  } catch (e) {
    coreNotify(
      t('lorebooks.hybridFtsSaveFailed'),
      e instanceof Error ? e.message : undefined,
      { level: 'error' },
    )
  } finally {
    hybridFtsSaving.value = false
  }
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

function createEntry() {
  const gid = activeGroupId.value
  if (!gid) return
  store.createEntry(gid)
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

onMounted(() => {
  void store.loadFromServer()
  window.addEventListener('keydown', onMultiSelectKeydown)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onMultiSelectKeydown)
})

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
        class="page-alert mb-0"
      >
        {{ lastError }}
      </v-alert>

      <v-alert
        v-if="activeLorebook.id && hybridFtsStale"
        type="warning"
        density="compact"
        variant="tonal"
        class="page-alert hybrid-fts-alert mb-0"
        role="button"
        tabindex="0"
        @click="hybridFtsDialogOpen = true"
        @keydown.enter="hybridFtsDialogOpen = true"
        @keydown.space.prevent="hybridFtsDialogOpen = true"
      >
        {{ $t('lorebooks.hybridFtsStaleAlert') }}
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
            <v-list density="compact" min-width="240" max-width="360">
              <v-list-item
                v-for="lb in lorebooks"
                :key="lb.id"
                :title="lb.name"
                :active="lb.id === activeLorebookId"
                @click="switchLorebook(lb.id)"
              >
                <template
                  v-if="lorebookShowsHybridFtsStale(lb)"
                  #append
                >
                  <v-chip
                    size="x-small"
                    color="warning"
                    variant="tonal"
                  >
                    {{ $t('settings.hybridFtsAsset.stale') }}
                  </v-chip>
                </template>
              </v-list-item>
            </v-list>
          </v-menu>
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('lorebooks.bookNew')"
            @click="dialogsRef?.openCreateLorebook()"
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
            @click="dialogsRef?.openRenameLorebook()"
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
            @click="dialogsRef?.openDeleteLorebook()"
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
          <button
            type="button"
            class="preset-bar__icon-btn"
            :title="$t('lorebooks.hybridFtsSettings')"
            :aria-label="$t('lorebooks.hybridFtsSettings')"
            :disabled="!activeLorebook.id"
            @click="hybridFtsDialogOpen = true"
          >
            <v-icon size="16">mdi-text-search</v-icon>
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
            @dblclick="dialogsRef?.openRenameGroup(g)"
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
              @click.stop="dialogsRef?.openRenameGroup(g)"
            >
              <v-icon size="11">mdi-pencil-outline</v-icon>
            </button>
            <button
              type="button"
              class="group-chip__close"
              @click.stop="dialogsRef?.openDeleteGroup(g)"
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
          @click="dialogsRef?.openAddGroup()"
          @dragover="onGroupDragOver(activeGroups.length, $event)"
          @drop="onGroupDrop(activeGroups.length)"
        >
          <v-icon size="14">mdi-plus</v-icon>
          <span>{{ $t('lorebooks.groupAdd') }}</span>
        </button>
      </div>

      <div class="prompts-layout">
        <LorebooksListPanel
          @batch-transfer="onListBatchTransfer"
          @create-entry="createEntry"
        />
        <LorebooksEntryEditor
          ref="editorRef"
          :embedded="props.embedded"
          @batch-transfer="onEditorBatchTransfer"
          @delete-entry="onDeleteEntry"
          @create-entry="createEntry"
        />
      </div>
    </div>

    <LorebooksDialogs
      ref="dialogsRef"
      v-model:import-confirm-open="importConfirmOpen"
      v-model:import-error-open="importErrorOpen"
      :import-error-msg="importErrorMsg"
      :import-preview-name="importPreviewName"
      :import-doing="importDoing"
      @confirm-import="confirmImportLorebook"
    />

    <v-dialog
      v-model="hybridFtsDialogOpen"
      max-width="620"
      :persistent="hybridFtsSaving || hybridFtsRebuilding"
    >
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between ga-3">
          <span>{{ $t('lorebooks.hybridFtsSettings') }}</span>
          <v-btn
            icon="mdi-close"
            variant="text"
            size="small"
            :aria-label="$t('settings.closeModal')"
            :disabled="hybridFtsSaving || hybridFtsRebuilding"
            @click="hybridFtsDialogOpen = false"
          />
        </v-card-title>
        <v-card-text>
          <HybridFtsAssetSettings
            v-if="activeLorebook.id"
            :model-value="activeLorebook.hybridFts"
            :global-settings="globalHybridFts"
            :built-spec="activeLorebook.builtHybridFtsSpec"
            :stale="hybridFtsStale"
            :index-applicable="activeLorebookHasVectorEntries"
            :saving="hybridFtsSaving"
            :rebuilding="hybridFtsRebuilding"
            @change="changeActiveHybridFts"
            @rebuild="rebuildActiveLorebook"
          />
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
/* Shared layout with PromptsView — see @/styles/prompts-library.css */
.page-alert {
  flex: 0 0 auto;
}

.hybrid-fts-alert {
  cursor: pointer;
}
</style>
