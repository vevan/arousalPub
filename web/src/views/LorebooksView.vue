<script setup lang="ts">
import LorebooksDialogs from '@/components/lorebooks/LorebooksDialogs.vue'
import LorebooksEntryEditor from '@/components/lorebooks/LorebooksEntryEditor.vue'
import LorebooksListPanel from '@/components/lorebooks/LorebooksListPanel.vue'
import { useLorebooksStore } from '@/stores/lorebooks'
import { parseLorebookImport } from '@/utils/lorebooks-package'
import { useNarrowLayout } from '@/composables/use-narrow-layout'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{ embedded?: boolean }>(),
  { embedded: false },
)

const emit = defineEmits<{
  close: []
}>()

const store = useLorebooksStore()

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
  </div>
</template>

<style scoped>
/* Shared layout with PromptsView — see @/styles/prompts-library.css */
</style>
