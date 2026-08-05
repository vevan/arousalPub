<script setup lang="ts">
import EntryBatchTargetDialog from '@/components/EntryBatchTargetDialog.vue'
import { useDeleteConfirmDialog } from '@/composables/useDeleteConfirmDialog'
import { useLorebooksStore } from '@/stores/lorebooks'
import type { LorebookGroup } from '@/stores/lorebooks'
import { coreNotify } from '@/utils/core-notify'
import type { BatchTransferTarget } from '@/utils/entry-batch-transfer'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  importConfirmOpen: boolean
  importErrorOpen: boolean
  importErrorMsg: string
  importPreviewName: string
  importDoing: boolean
}>()

const emit = defineEmits<{
  'update:importConfirmOpen': [v: boolean]
  'update:importErrorOpen': [v: boolean]
  'confirm-import': []
}>()

const { t } = useI18n()
const store = useLorebooksStore()
const {
  lorebooks,
  activeLorebookId,
  activeGroupId,
  activeLorebook,
  selectedEntry,
  selectedEntryIds,
} = storeToRefs(store)

const lorebookCreateOpen = ref(false)
const lorebookCreateName = ref('')
const lorebookRenameOpen = ref(false)
const lorebookRenameDraft = ref('')
const {
  open: lorebookDeleteOpen,
  askDelete: askDeleteLorebook,
  close: closeDeleteLorebook,
  confirm: runDeleteLorebook,
} = useDeleteConfirmDialog()

const groupAddOpen = ref(false)
const groupAddName = ref('')
const groupRenameOpen = ref(false)
const groupRenameDraft = ref('')
const groupRenameTarget = ref<LorebookGroup | null>(null)
const {
  open: groupDeleteOpen,
  targetLabel: groupDeleteLabel,
  askDelete: askDeleteGroup,
  close: closeDeleteGroup,
  confirm: runDeleteGroup,
} = useDeleteConfirmDialog()

const {
  open: entryDeleteOpen,
  askDelete: askDeleteEntry,
  close: closeDeleteEntry,
  confirm: runDeleteEntry,
} = useDeleteConfirmDialog()

const batchTransferOpen = ref(false)
const batchTransferMode = ref<'copy' | 'move'>('copy')
const batchTransferSingle = ref(false)
const pendingTransferIds = ref<string[]>([])

const batchLibraries = computed(() =>
  lorebooks.value.map((lb) => ({ id: lb.id, name: lb.name })),
)

const batchCurrentGroupId = computed(() => {
  const ids = pendingTransferIds.value
  if (ids.length === 0) return activeGroupId.value
  const gids = new Set(
    activeLorebook.value.entries
      .filter((e) => ids.includes(e.id))
      .map((e) => e.groupId),
  )
  return gids.size === 1 ? [...gids][0]! : null
})

watch(batchTransferOpen, (open) => {
  if (open) return
  pendingTransferIds.value = []
  batchTransferSingle.value = false
})

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
  askDeleteLorebook(activeLorebookId.value, activeLorebook.value.name)
}
function performDeleteLorebook() {
  void runDeleteLorebook((id) => {
    store.deleteLorebook(id)
  })
}

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
  askDeleteGroup(g.id, g.name)
}
function performDeleteGroup() {
  void runDeleteGroup((id) => {
    store.deleteGroup(id)
  })
}

function openBatchTransfer(mode: 'copy' | 'move') {
  if (selectedEntryIds.value.length === 0) return
  batchTransferSingle.value = false
  pendingTransferIds.value = selectedEntryIds.value.slice()
  batchTransferMode.value = mode
  batchTransferOpen.value = true
}

function openEntryTransfer(mode: 'copy' | 'move') {
  if (!selectedEntry.value) return
  batchTransferSingle.value = true
  pendingTransferIds.value = [selectedEntry.value.id]
  batchTransferMode.value = mode
  batchTransferOpen.value = true
}

function onBatchTransferPick(target: BatchTransferTarget) {
  const ids = pendingTransferIds.value.slice()
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

function confirmDeleteEntry() {
  if (!selectedEntry.value) return
  askDeleteEntry(selectedEntry.value.id, selectedEntry.value.title)
}
function performDeleteEntry() {
  void runDeleteEntry((id) => {
    store.deleteEntry(id)
  })
}

const importConfirmOpen = computed({
  get: () => props.importConfirmOpen,
  set: (v: boolean) => emit('update:importConfirmOpen', v),
})
const importErrorOpen = computed({
  get: () => props.importErrorOpen,
  set: (v: boolean) => emit('update:importErrorOpen', v),
})

function confirmImportLorebook() {
  emit('confirm-import')
}

const blockingEscape = computed(
  () => batchTransferOpen.value || entryDeleteOpen.value,
)

defineExpose({
  openCreateLorebook,
  openRenameLorebook,
  openDeleteLorebook,
  openAddGroup,
  openRenameGroup,
  openDeleteGroup,
  openBatchTransfer,
  openEntryTransfer,
  confirmDeleteEntry,
  blockingEscape,
})
</script>

<template>
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
          <v-btn variant="text" @click="closeDeleteLorebook">{{ $t('settings.themeCancel') }}</v-btn>
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
        <v-card-text>{{ $t('lorebooks.groupDeleteBody', { name: groupDeleteLabel }) }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeDeleteGroup">{{ $t('settings.themeCancel') }}</v-btn>
          <v-btn color="error" variant="flat" @click="performDeleteGroup">{{ $t('settings.themeConfirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <EntryBatchTargetDialog
      v-model:open="batchTransferOpen"
      :mode="batchTransferMode"
      :libraries="batchLibraries"
      :current-library-id="activeLorebookId"
      :current-group-id="batchCurrentGroupId"
      :resolve-groups="store.groupsForLorebook"
      :single-entry="batchTransferSingle"
      @pick="onBatchTransferPick"
    />

    <v-dialog v-model="entryDeleteOpen" max-width="24rem">
      <v-card>
        <v-card-title class="text-subtitle-1">{{ $t('lorebooks.entryDeleteDialog') }}</v-card-title>
        <v-card-text>{{ $t('lorebooks.entryDeleteBody', { title: selectedEntry?.title || $t('lorebooks.untitled') }) }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="closeDeleteEntry">{{ $t('settings.themeCancel') }}</v-btn>
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
</template>
