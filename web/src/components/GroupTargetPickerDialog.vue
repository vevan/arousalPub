<script setup lang="ts">
import type { GroupPickerItem } from '@/utils/entry-group-transfer'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const open = defineModel<boolean>('open', { required: true })

const props = defineProps<{
  mode: 'copy' | 'move'
  groups: GroupPickerItem[]
  /** 移动时禁用当前分组（无意义） */
  currentGroupId?: string
}>()

const emit = defineEmits<{
  pick: [groupId: string]
}>()

const { t } = useI18n()

const title = computed(() =>
  props.mode === 'copy'
    ? t('entryTransfer.pickGroupCopyTitle')
    : t('entryTransfer.pickGroupMoveTitle'),
)

const hint = computed(() =>
  props.mode === 'copy'
    ? t('entryTransfer.pickGroupCopyHint')
    : t('entryTransfer.pickGroupMoveHint'),
)

function isDisabled(g: GroupPickerItem): boolean {
  if (g.disabled) return true
  if (props.mode === 'move' && props.currentGroupId && g.id === props.currentGroupId) {
    return true
  }
  return false
}

function onPick(g: GroupPickerItem) {
  if (isDisabled(g)) return
  emit('pick', g.id)
  open.value = false
}
</script>

<template>
  <v-dialog v-model="open" max-width="22rem">
    <v-card>
      <v-card-title class="text-subtitle-1">{{ title }}</v-card-title>
      <v-card-text class="text-body-2 pb-1">{{ hint }}</v-card-text>
      <v-list density="compact" class="py-0">
        <v-list-item
          v-for="g in groups"
          :key="g.id"
          :disabled="isDisabled(g)"
          :title="g.name"
          :subtitle="t('entryTransfer.groupEntryCount', { n: g.count })"
          @click="onPick(g)"
        />
      </v-list>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">{{ $t('settings.themeCancel') }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>
