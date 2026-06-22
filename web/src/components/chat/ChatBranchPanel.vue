<script setup lang="ts">
import { branchPathLabel } from '@/utils/conversation-branches-api'
import type { BranchTreeNodeDto } from '@/utils/conversation-branches-api'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  modelValue: boolean
  nodes: BranchTreeNodeDto[]
  activeBranchPath: string
  busy: boolean
  errorText?: string
}>()

const emit = defineEmits<{
  'update:modelValue': [open: boolean]
  select: [path: string]
}>()

const { t } = useI18n()

type FlatNode = { node: BranchTreeNodeDto; depth: number }

function flatten(nodes: BranchTreeNodeDto[], depth = 0): FlatNode[] {
  const out: FlatNode[] = []
  for (const node of nodes) {
    out.push({ node, depth })
    if (node.children.length > 0) {
      out.push(...flatten(node.children, depth + 1))
    }
  }
  return out
}

const flatNodes = computed(() => flatten(props.nodes))

function nodeLabel(node: BranchTreeNodeDto): string {
  return branchPathLabel(node.path, node, t)
}

function close() {
  emit('update:modelValue', false)
}
</script>

<template>
  <v-dialog
    :model-value="modelValue"
    max-width="28rem"
    class="chat-branch-panel"
    @update:model-value="emit('update:modelValue', $event)"
  >
    <v-card>
      <v-card-title class="d-flex align-center gap-2 text-body-1 font-weight-medium">
        <v-icon icon="mdi-source-branch" size="20" />
        {{ $t('chat.branches.panelTitle') }}
        <v-spacer />
        <v-btn
          icon="mdi-close"
          variant="text"
          density="comfortable"
          size="small"
          :aria-label="$t('settings.themeCancel')"
          @click="close"
        />
      </v-card-title>
      <v-card-text class="pa-0">
        <v-alert
          v-if="errorText"
          type="error"
          variant="tonal"
          density="compact"
          class="ma-3 mb-0"
        >
          {{ errorText }}
        </v-alert>
        <v-list density="compact" class="chat-branch-panel__list">
          <v-list-item
            v-for="{ node, depth } in flatNodes"
            :key="node.path || '__main__'"
            :active="node.path === activeBranchPath"
            :disabled="busy"
            :style="{ paddingInlineStart: `${12 + depth * 16}px` }"
            @click="emit('select', node.path)"
          >
            <template #prepend>
              <v-icon
                :icon="node.path ? 'mdi-source-branch' : 'mdi-home-outline'"
                size="18"
              />
            </template>
            <v-list-item-title>{{ nodeLabel(node) }}</v-list-item-title>
            <v-list-item-subtitle v-if="node.path && node.turnCount > 0">
              {{ $t('chat.branches.turnCount', { n: node.turnCount }) }}
            </v-list-item-subtitle>
          </v-list-item>
        </v-list>
        <p v-if="flatNodes.length === 0 && !busy" class="text-body-2 text-medium-emphasis pa-4">
          {{ $t('chat.branches.empty') }}
        </p>
      </v-card-text>
      <v-card-actions v-if="busy" class="px-4 pb-3">
        <v-progress-linear indeterminate color="primary" />
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
@media (max-width: 40rem) {
  :deep(.chat-branch-panel .v-overlay__content) {
    max-width: 100% !important;
    margin: 0;
    align-self: flex-end;
  }
}
</style>
