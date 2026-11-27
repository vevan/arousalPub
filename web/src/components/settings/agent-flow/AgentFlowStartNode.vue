<script setup lang="ts">
import { Handle, Position, type NodeProps } from '@xyflow/vue'
import type { AgentFlowNode } from '@/utils/agent-flow-graph'
import './agent-flow-node.css'

const props = defineProps<NodeProps<AgentFlowNode>>()
</script>

<template>
  <div class="agent-flow-node agent-flow-node--start">
    <div class="agent-flow-node__head">
      <span class="agent-flow-node__phase">{{ $t('settings.agent.badgeStart') }}</span>
    </div>
    <div class="agent-flow-node__title">{{ props.data.label }}</div>
    <Handle type="source" :position="Position.Bottom" />
  </div>
</template>
