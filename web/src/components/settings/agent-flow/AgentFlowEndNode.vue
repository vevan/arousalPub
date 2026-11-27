<script setup lang="ts">
import { Handle, Position, type NodeProps } from '@xyflow/vue'
import type { AgentFlowNode } from '@/utils/agent-flow-graph'
import './agent-flow-node.css'

const props = defineProps<NodeProps<AgentFlowNode>>()
</script>

<template>
  <div class="agent-flow-node agent-flow-node--end">
    <Handle type="target" :position="Position.Top" />
    <div class="agent-flow-node__head">
      <span class="agent-flow-node__phase">{{ $t('settings.agent.badgeEnd') }}</span>
    </div>
    <div class="agent-flow-node__title">{{ props.data.label }}</div>
  </div>
</template>
