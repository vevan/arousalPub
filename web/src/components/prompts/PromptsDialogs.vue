<script setup lang="ts">
import AssembledMessagesPanel from '@/components/prompts/AssembledMessagesPanel.vue'
import EntryBatchTargetDialog from '@/components/EntryBatchTargetDialog.vue'
import { useConnectionStore } from '@/stores/connection'
import {
  usePromptsStore,
  type PromptGroup,
  type PromptTrigger,
} from '@/stores/prompts'
import { coreNotify } from '@/utils/core-notify'
import type { BatchTransferTarget } from '@/utils/entry-batch-transfer'
import { formatChatMessagesForDisplay } from '@/utils/format-prompt-json-display'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  importErrorOpen: boolean
  importErrorMsg: string
  stImportConfirmOpen: boolean
  stImportDoing: boolean
  stImportPreviewName: string
}>()

const emit = defineEmits<{
  'update:importErrorOpen': [v: boolean]
  'update:stImportConfirmOpen': [v: boolean]
  'confirm-st-import': []
}>()

const { t } = useI18n()
const store = usePromptsStore()
const conn = useConnectionStore()
const {
  presets,
  editingPresetId,
  activePreset,
  activeGroupId,
  selected,
  selectedPromptIds,
} = storeToRefs(store)

const TRIGGER_OPTIONS: { id: PromptTrigger; key: string }[] = [
  { id: 'normal', key: 'prompts.triggerNormal' },
  { id: 'continue', key: 'prompts.triggerContinue' },
  { id: 'swipe', key: 'prompts.triggerSwipe' },
  { id: 'regenerate', key: 'prompts.triggerRegenerate' },
]

const presetCreateOpen = ref(false)
const presetCreateName = ref('')
const presetRenameOpen = ref(false)
const presetRenameDraft = ref('')
const presetDeleteOpen = ref(false)

const groupAddOpen = ref(false)
const groupAddName = ref('')
const groupDeleteOpen = ref(false)
const groupDeleteTarget = ref<PromptGroup | null>(null)

const entryDeleteOpen = ref(false)

const batchTransferOpen = ref(false)
const batchTransferMode = ref<'copy' | 'move'>('copy')
const batchTransferSingle = ref(false)
const pendingTransferIds = ref<string[]>([])

const batchLibraries = computed(() =>
  presets.value.map((p) => ({ id: p.id, name: p.name })),
)

const batchCurrentGroupId = computed(() => {
  const ids = pendingTransferIds.value
  if (ids.length === 0) return activeGroupId.value
  const gids = new Set(
    activePreset.value.prompts
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
  store.renamePreset(editingPresetId.value, presetRenameDraft.value)
  presetRenameOpen.value = false
}
function openDeletePreset() {
  if (presets.value.length <= 1) return
  presetDeleteOpen.value = true
}
function performDeletePreset() {
  void (async () => {
    const ok = await store.deletePreset(editingPresetId.value)
    presetDeleteOpen.value = false
    if (!ok) {
      coreNotify(
        store.lastError?.trim() || t('prompts.presetDeleteFailed'),
        undefined,
        { level: 'error' },
      )
    }
  })()
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
function openDeleteGroup(g: PromptGroup) {
  groupDeleteTarget.value = g
  groupDeleteOpen.value = true
}
function performDeleteGroup() {
  if (!groupDeleteTarget.value) return
  store.deleteGroup(groupDeleteTarget.value.id)
  groupDeleteOpen.value = false
}

function openBatchTransfer(mode: 'copy' | 'move') {
  if (selectedPromptIds.value.length === 0) return
  batchTransferSingle.value = false
  pendingTransferIds.value = selectedPromptIds.value.slice()
  batchTransferMode.value = mode
  batchTransferOpen.value = true
}

function openEntryTransfer(mode: 'copy' | 'move') {
  if (!selected.value || selected.value.bindingSlot) return
  batchTransferSingle.value = true
  pendingTransferIds.value = [selected.value.id]
  batchTransferMode.value = mode
  batchTransferOpen.value = true
}

async function ensureBatchLibrary(libraryId: string) {
  try {
    await store.ensurePresetLoaded(libraryId)
  } catch (e) {
    coreNotify(
      store.lastError?.trim() ||
        (e instanceof Error ? e.message : String(e)) ||
        t('entryTransfer.batchTargetMissing'),
      undefined,
      { level: 'error', snackbar: true },
    )
    throw e
  }
}

async function onBatchTransferPick(target: BatchTransferTarget) {
  const ids = pendingTransferIds.value.slice()
  const result =
    batchTransferMode.value === 'copy'
      ? await store.batchDuplicatePrompts(
          ids,
          target.libraryId,
          target.groupId,
        )
      : await store.batchMovePrompts(ids, target.libraryId, target.groupId)
  if (result.skippedSlots > 0) {
    coreNotify(
      t('entryTransfer.batchSkippedSlots', { n: result.skippedSlots }),
      undefined,
      { level: 'warning', snackbar: true },
    )
  }
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
  if (!selected.value) return
  entryDeleteOpen.value = true
}
function performDeleteEntry() {
  if (!selected.value) return
  store.deletePrompt(selected.value.id)
  entryDeleteOpen.value = false
}

const importErrorOpen = computed({
  get: () => props.importErrorOpen,
  set: (v: boolean) => emit('update:importErrorOpen', v),
})
const stImportConfirmOpen = computed({
  get: () => props.stImportConfirmOpen,
  set: (v: boolean) => emit('update:stImportConfirmOpen', v),
})

function confirmStImport() {
  emit('confirm-st-import')
}

/** ============== preview modal ============== */
const previewOpen = ref(false)
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
  try {
    const res = await fetch('/api/prompts/assemble-preview', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        presetId: p.id,
        promptTrigger: previewTrigger.value,
        conversationUserName: 'User',
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

const blockingEscape = computed(
  () => batchTransferOpen.value || entryDeleteOpen.value,
)

defineExpose({
  openCreatePreset,
  openRenamePreset,
  openDeletePreset,
  openAddGroup,
  openDeleteGroup,
  openBatchTransfer,
  openEntryTransfer,
  confirmDeleteEntry,
  openPreview,
  blockingEscape,
})
</script>

<template>
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

    <EntryBatchTargetDialog
      v-model:open="batchTransferOpen"
      :mode="batchTransferMode"
      :libraries="batchLibraries"
      :current-library-id="editingPresetId"
      :current-group-id="batchCurrentGroupId"
      :resolve-groups="store.groupsForPreset"
      :ensure-library="ensureBatchLibrary"
      :single-entry="batchTransferSingle"
      @pick="onBatchTransferPick"
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
</template>
