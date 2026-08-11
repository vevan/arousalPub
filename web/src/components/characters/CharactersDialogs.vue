<script setup lang="ts">
import CharacterImageFilesPanel from '@/components/CharacterImageFilesPanel.vue'
import type { ComponentPublicInstance } from 'vue'

const props = defineProps<{
  imageFilesOpen: boolean
  selectedId: string | null
  deleteOpen: boolean
  deleteTargetLabel: string
  deleteDoing: boolean
  bindImageFilesPanel: (
    el: { openPicker: () => void | Promise<void> } | null,
  ) => void
}>()

const emit = defineEmits<{
  'update:imageFilesOpen': [value: boolean]
  'update:deleteOpen': [value: boolean]
  'close-delete': []
  'confirm-delete': []
  'open-picker': []
}>()

function onImageFilesPanelRef(
  el: Element | ComponentPublicInstance | null,
) {
  const panel = el as { openPicker?: () => void | Promise<void> } | null
  props.bindImageFilesPanel(
    panel && typeof panel.openPicker === 'function'
      ? (panel as { openPicker: () => void | Promise<void> })
      : null,
  )
}
</script>

<template>
  <v-dialog
    :model-value="imageFilesOpen"
    max-width="560"
    scrollable
    content-class="cif-dialog"
    @update:model-value="emit('update:imageFilesOpen', $event)"
  >
    <v-card class="cif-dialog__card">
      <v-card-title>{{ $t('characters.imageFilesTitle') }}</v-card-title>
      <v-card-text class="cif-dialog__body">
        <CharacterImageFilesPanel
          v-if="imageFilesOpen && selectedId"
          :ref="onImageFilesPanelRef"
          :character-id="selectedId"
          :embedded="true"
        />
      </v-card-text>
      <v-card-actions class="cif-dialog-footer">
        <p class="text-caption text-medium-emphasis cif-dialog-footer__hint mb-0">
          {{ $t('characters.imageFilesHint', { max: 30 }) }}
        </p>
        <v-spacer />
        <v-btn variant="text" @click="emit('update:imageFilesOpen', false)">
          {{ $t('characters.cancel') }}
        </v-btn>
        <v-btn
          color="primary"
          variant="tonal"
          @click="emit('open-picker')"
        >
          {{ $t('characters.imageFilesPick') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>

  <v-dialog
    :model-value="deleteOpen"
    @update:model-value="emit('update:deleteOpen', $event)"
  >
    <v-card>
      <v-card-title>{{ $t('characters.deleteDialogTitle') }}</v-card-title>
      <v-card-text>
        {{ $t('characters.deleteDialogBody', { name: deleteTargetLabel }) }}
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="emit('close-delete')">
          {{ $t('characters.cancel') }}
        </v-btn>
        <v-btn color="error" :loading="deleteDoing" @click="emit('confirm-delete')">
          {{ $t('characters.delete') }}
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.cif-dialog-footer {
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  flex-shrink: 0;
}

.cif-dialog-footer__hint {
  flex: 1 1 12rem;
  min-width: 0;
  max-width: 100%;
  line-height: 1.35;
}

.cif-dialog__card {
  display: flex;
  flex-direction: column;
  min-height: 50vh;
  max-height: min(90vh, calc(100dvh - 3rem));
}

.cif-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}
</style>
