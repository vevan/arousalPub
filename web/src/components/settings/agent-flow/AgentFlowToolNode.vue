<script setup lang="ts">
import { Handle, Position, type NodeProps } from '@xyflow/vue'
import { computed, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentFlowNode } from '@/utils/agent-flow-graph'
import { agentFlowActionsKey } from './agent-flow-actions'
import './agent-flow-node.css'

const props = defineProps<NodeProps<AgentFlowNode>>()
const { t } = useI18n()
const actions = inject(agentFlowActionsKey, null)
const readonly = computed(() => actions?.readonly.value === true)
const phaseClass = computed(() => {
  const p = props.data.phase
  if (p === 'write') return 'agent-flow-node--write'
  return 'agent-flow-node--read'
})
const phaseLabel = computed(() => {
  if (props.data.phase === 'write') return t('settings.agent.phaseWrite')
  if (props.data.phase === 'read') return t('settings.agent.phaseRead')
  return props.data.phase ?? ''
})
const toolName = computed(() =>
  props.data.step.kind === 'tool' ? props.data.step.toolName : '',
)
</script>

<template>
  <div class="agent-flow-node" :class="phaseClass">
    <Handle type="target" :position="Position.Top" />
    <div class="agent-flow-node__head">
      <span class="agent-flow-node__phase">{{ phaseLabel }}</span>
      <div v-if="!readonly" class="agent-flow-node__actions">
        <button
          type="button"
          class="agent-flow-node__btn"
          @click.stop="actions?.editNode(props.id)"
        >
          ···
        </button>
        <button
          type="button"
          class="agent-flow-node__btn"
          @click.stop="actions?.removeNode(props.id)"
        >
          ×
        </button>
      </div>
    </div>
    <div class="agent-flow-node__title">{{ props.data.label }}</div>
    <div v-if="toolName" class="agent-flow-node__meta">{{ toolName }}</div>
    <div
      v-if="props.data.step.kind === 'tool' && props.data.step.required"
      class="agent-flow-node__meta"
    >
      {{ $t('settings.agent.badgeRequired') }}
    </div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
