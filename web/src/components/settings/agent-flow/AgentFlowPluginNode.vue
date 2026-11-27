<script setup lang="ts">
import { Handle, Position, type NodeProps } from '@xyflow/vue'
import { computed, inject } from 'vue'
import type { AgentFlowNode } from '@/utils/agent-flow-graph'
import { agentFlowActionsKey } from './agent-flow-actions'
import './agent-flow-node.css'

const props = defineProps<NodeProps<AgentFlowNode>>()
const actions = inject(agentFlowActionsKey, null)
const readonly = computed(() => actions?.readonly.value === true)
const typeLabel = computed(() => {
  const s = props.data.step
  return s.kind === 'node' ? s.type : props.data.label
})
</script>

<template>
  <div class="agent-flow-node agent-flow-node--plugin">
    <Handle type="target" :position="Position.Top" />
    <div class="agent-flow-node__head">
      <span class="agent-flow-node__phase">{{ $t('settings.agent.badgeNode') }}</span>
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
    <div class="agent-flow-node__meta">{{ typeLabel }}</div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
