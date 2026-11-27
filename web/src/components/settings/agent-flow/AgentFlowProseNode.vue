<script setup lang="ts">
import { Handle, Position, type NodeProps } from '@xyflow/vue'
import { computed, inject } from 'vue'
import type { AgentFlowNode } from '@/utils/agent-flow-graph'
import { agentFlowActionsKey } from './agent-flow-actions'
import './agent-flow-node.css'

const props = defineProps<NodeProps<AgentFlowNode>>()
const actions = inject(agentFlowActionsKey, null)
const readonly = computed(() => actions?.readonly.value === true)
</script>

<template>
  <div class="agent-flow-node agent-flow-node--prose">
    <Handle type="target" :position="Position.Top" />
    <div class="agent-flow-node__head">
      <span class="agent-flow-node__phase">{{ $t('settings.agent.badgeProse') }}</span>
      <button
        v-if="!readonly"
        type="button"
        class="agent-flow-node__btn"
        @click.stop="actions?.editNode(props.id)"
      >
        ···
      </button>
    </div>
    <div class="agent-flow-node__title">{{ props.data.label }}</div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
