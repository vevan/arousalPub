<script setup lang="ts">
import type { GroupPickerItem } from '@/utils/entry-group-transfer'
import {
  isBatchGroupDisabled,
  type BatchLibraryItem,
  type BatchTransferMode,
  type BatchTransferTarget,
} from '@/utils/entry-batch-transfer'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  mode: BatchTransferMode
  libraries: BatchLibraryItem[]
  currentLibraryId: string
  currentGroupId?: string | null
  resolveGroups: (libraryId: string) => GroupPickerItem[]
  /** 选库进入分组步之前可选加载（如提示词预设 body） */
  ensureLibrary?: (libraryId: string) => void | Promise<void>
}>()

const emit = defineEmits<{
  pick: [BatchTransferTarget]
}>()

const { t } = useI18n()

const step = ref<'library' | 'group'>('library')
const targetLibraryId = ref<string | null>(null)
const loadingLibrary = ref(false)

async function enterGroupStep(libraryId: string) {
  loadingLibrary.value = true
  try {
    await props.ensureLibrary?.(libraryId)
    targetLibraryId.value = libraryId
    step.value = 'group'
  } catch {
    // 保持在库列表；加载失败不进入分组步
    targetLibraryId.value = null
    step.value = 'library'
  } finally {
    loadingLibrary.value = false
  }
}

watch(open, (v) => {
  if (!v) return
  step.value = 'library'
  targetLibraryId.value = null
  loadingLibrary.value = false
  if (props.libraries.length === 1) {
    void enterGroupStep(props.libraries[0]!.id)
  }
})

const title = computed(() =>
  props.mode === 'copy'
    ? t('entryTransfer.batchPickCopyTitle')
    : t('entryTransfer.batchPickMoveTitle'),
)

const libraryHint = computed(() =>
  props.mode === 'copy'
    ? t('entryTransfer.batchPickLibraryCopyHint')
    : t('entryTransfer.batchPickLibraryMoveHint'),
)

const groupHint = computed(() =>
  props.mode === 'copy'
    ? t('entryTransfer.batchPickGroupCopyHint')
    : t('entryTransfer.batchPickGroupMoveHint'),
)

const targetGroups = computed(() => {
  const lid = targetLibraryId.value
  if (!lid) return [] as GroupPickerItem[]
  return props.resolveGroups(lid)
})

const targetLibraryName = computed(() => {
  const lid = targetLibraryId.value
  if (!lid) return ''
  return props.libraries.find((x) => x.id === lid)?.name ?? lid
})

function onPickLibrary(lib: BatchLibraryItem) {
  if (loadingLibrary.value) return
  void enterGroupStep(lib.id)
}

function groupDisabled(g: GroupPickerItem): boolean {
  const lid = targetLibraryId.value
  if (!lid) return true
  return isBatchGroupDisabled(props.mode, g, {
    currentLibraryId: props.currentLibraryId,
    targetLibraryId: lid,
    currentGroupId: props.currentGroupId,
  })
}

function onPickGroup(g: GroupPickerItem) {
  if (groupDisabled(g) || !targetLibraryId.value) return
  emit('pick', { libraryId: targetLibraryId.value, groupId: g.id })
  open.value = false
}

function backToLibraries() {
  step.value = 'library'
  targetLibraryId.value = null
}
</script>

<template>
  <v-dialog v-model="open" max-width="24rem">
    <v-card :loading="loadingLibrary">
      <v-card-title class="text-subtitle-1">{{ title }}</v-card-title>
      <v-card-text class="text-body-2 pb-1">
        <template v-if="step === 'library'">{{ libraryHint }}</template>
        <template v-else>
          {{ groupHint }}
          <span class="text-medium-emphasis"> · {{ targetLibraryName }}</span>
        </template>
      </v-card-text>

      <v-list v-if="step === 'library'" density="compact" class="py-0">
        <v-list-item
          v-for="lib in libraries"
          :key="lib.id"
          :title="lib.name"
          :disabled="loadingLibrary"
          :subtitle="
            lib.id === currentLibraryId
              ? $t('entryTransfer.batchCurrentLibrary')
              : undefined
          "
          @click="onPickLibrary(lib)"
        />
      </v-list>

      <v-list v-else density="compact" class="py-0">
        <v-list-item
          v-for="g in targetGroups"
          :key="g.id"
          :disabled="groupDisabled(g)"
          :title="g.name"
          :subtitle="t('entryTransfer.groupEntryCount', { n: g.count })"
          @click="onPickGroup(g)"
        />
      </v-list>

      <v-card-actions>
        <v-btn
          v-if="step === 'group' && libraries.length > 1"
          variant="text"
          @click="backToLibraries"
        >{{ $t('entryTransfer.batchBack') }}</v-btn>
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ $t('settings.themeCancel') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
