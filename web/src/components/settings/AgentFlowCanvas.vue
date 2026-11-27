<script setup lang="ts">
import {
  Background,
  Controls,
  EdgeChangeset,
  VueFlow,
  addEdge,
  type Connection,
  type Edge,
  type VueFlowInstance,
} from '@xyflow/vue'
import '@xyflow/vue/style.css'
import { computed, markRaw, provide, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type {
  AgentFlowEdgeConfig,
  AgentFlowPositions,
  AgentPipelineStepConfig,
} from '@/types/agent-settings'
import {
  AGENT_FLOW_NODE_BRANCH,
  AGENT_FLOW_NODE_END,
  AGENT_FLOW_NODE_PLUGIN,
  AGENT_FLOW_NODE_PROSE,
  AGENT_FLOW_NODE_START,
  AGENT_FLOW_NODE_TOOL,
  buildChainEdges,
  flowToStepsAndEdges,
  stepNodeId,
  stepsToFlowElements,
  type AgentFlowNode,
} from '@/utils/agent-flow-graph'
import AgentFlowBranchNode from './agent-flow/AgentFlowBranchNode.vue'
import AgentFlowEndNode from './agent-flow/AgentFlowEndNode.vue'
import AgentFlowPluginNode from './agent-flow/AgentFlowPluginNode.vue'
import AgentFlowProseNode from './agent-flow/AgentFlowProseNode.vue'
import AgentFlowStartNode from './agent-flow/AgentFlowStartNode.vue'
import AgentFlowToolNode from './agent-flow/AgentFlowToolNode.vue'
import {
  agentFlowActionsKey,
  type AgentFlowActions,
} from './agent-flow/agent-flow-actions'

const props = withDefaults(
  defineProps<{
    steps: AgentPipelineStepConfig[]
    edges?: AgentFlowEdgeConfig[]
    positions?: AgentFlowPositions
    phaseOf: (toolName: string) => 'read' | 'write' | undefined
    labelOf?: (step: AgentPipelineStepConfig) => string
    mode?: 'preview' | 'edit'
    disabled?: boolean
  }>(),
  { mode: 'preview', edges: () => [], positions: () => ({}) },
)

const emit = defineEmits<{
  'update:graph': [
    payload: {
      steps: AgentPipelineStepConfig[]
      edges: AgentFlowEdgeConfig[]
      positions: AgentFlowPositions
    },
  ]
  edit: [index: number]
  remove: [index: number]
}>()

const { t } = useI18n()

const nodes = shallowRef<AgentFlowNode[]>([])
const flowEdges = shallowRef<Edge[]>([])
const syncingFromProps = shallowRef(false)
const flowApi = shallowRef<VueFlowInstance | null>(null)
const selectedEdgeCount = shallowRef(0)
const rootEl = shallowRef<HTMLElement | null>(null)
/** 编辑态仅首次 / 主动 fit；拖拽改布局后不再自动缩放平移 */
const editFittedOnce = shallowRef(false)

const isPreview = computed(() => props.mode === 'preview')
const interactive = computed(() => !isPreview.value && !props.disabled)

const nodeTypes = {
  [AGENT_FLOW_NODE_TOOL]: markRaw(AgentFlowToolNode),
  [AGENT_FLOW_NODE_PROSE]: markRaw(AgentFlowProseNode),
  [AGENT_FLOW_NODE_BRANCH]: markRaw(AgentFlowBranchNode),
  [AGENT_FLOW_NODE_PLUGIN]: markRaw(AgentFlowPluginNode),
  [AGENT_FLOW_NODE_START]: markRaw(AgentFlowStartNode),
  [AGENT_FLOW_NODE_END]: markRaw(AgentFlowEndNode),
}

function fitViewOptions() {
  return {
    padding: '5%' as const,
    duration: isPreview.value ? 0 : 200,
    minZoom: 0.05,
    maxZoom: isPreview.value ? 1.35 : 1.5,
  }
}

function scheduleFitView() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      void flowApi.value?.fitView(fitViewOptions())
    })
  })
}

function maybeFitAfterRebuild(reason: 'preview' | 'edit-first' | 'skip') {
  if (reason === 'skip') return
  if (reason === 'preview') {
    scheduleFitView()
    return
  }
  if (!editFittedOnce.value) {
    editFittedOnce.value = true
    scheduleFitView()
  }
}

function rebuildFromProps(
  steps: AgentPipelineStepConfig[],
  edges: AgentFlowEdgeConfig[],
  positions: AgentFlowPositions,
) {
  syncingFromProps.value = true
  const next = stepsToFlowElements(steps, {
    phaseOf: props.phaseOf,
    proseLabel: t('settings.agent.proseNode'),
    branchLabel: t('settings.agent.branchNode'),
    startLabel: t('settings.agent.startNode'),
    endLabel: t('settings.agent.endNode'),
    labelOf: props.labelOf,
    edges,
    positions,
    // 禁止无边时按 steps 数组静默串链
    autoChain: false,
  })
  nodes.value = next.nodes
  flowEdges.value = next.edges
  selectedEdgeCount.value = 0
  queueMicrotask(() => {
    syncingFromProps.value = false
    maybeFitAfterRebuild(isPreview.value ? 'preview' : 'edit-first')
  })
}

watch(
  () => [props.steps, props.edges, props.positions] as const,
  ([steps, edges, positions]) => {
    rebuildFromProps(steps, edges ?? [], positions ?? {})
  },
  { immediate: true, deep: true },
)

watch(
  () => props.mode,
  () => {
    if (isPreview.value) scheduleFitView()
  },
)

function indexOfNodeId(nodeId: string): number {
  return nodes.value.findIndex((n) => n.id === nodeId)
}

const actions: AgentFlowActions = {
  readonly: computed(() => isPreview.value || props.disabled === true),
  editNode(nodeId) {
    if (!interactive.value) return
    const i = indexOfNodeId(nodeId)
    if (i >= 0) emit('edit', i)
  },
  removeNode(nodeId) {
    if (!interactive.value) return
    const i = indexOfNodeId(nodeId)
    if (i >= 0) emit('remove', i)
  },
}
provide(agentFlowActionsKey, actions)

function emitGraphFromFlow() {
  if (!interactive.value || syncingFromProps.value) return
  const orderIds = props.steps.map((s) => stepNodeId(s))
  const next = flowToStepsAndEdges(nodes.value, flowEdges.value, { orderIds })
  emit('update:graph', next)
}

function syncSelectedEdgeCount() {
  selectedEdgeCount.value = flowEdges.value.filter((e) => e.selected).length
}

function onEdgesChange(changes: EdgeChangeset) {
  if (!interactive.value || syncingFromProps.value) return
  const before = flowEdges.value.length
  flowEdges.value = changes.applyTo(flowEdges.value)
  syncSelectedEdgeCount()
  if (flowEdges.value.length !== before || changes.getByType('remove').length) {
    emitGraphFromFlow()
  }
}

function onConnect(connection: Connection) {
  if (!interactive.value) return
  flowEdges.value = addEdge(
    {
      ...connection,
      selectable: true,
      focusable: true,
      deletable: true,
      interactionWidth: 24,
    },
    flowEdges.value,
  )
  emitGraphFromFlow()
}

function onInit(api: VueFlowInstance) {
  flowApi.value = api
  if (isPreview.value) {
    scheduleFitView()
  } else if (!editFittedOnce.value) {
    editFittedOnce.value = true
    scheduleFitView()
  }
}

/** 当前视口左上角（flow 坐标，带内边距）；供新增节点落点 */
function getPlacementPosition(): { x: number; y: number } {
  const api = flowApi.value
  const pane =
    rootEl.value?.querySelector('.vue-flow__pane') ??
    rootEl.value?.querySelector('.vue-flow')
  if (api?.screenToFlowPosition && pane) {
    const rect = pane.getBoundingClientRect()
    const pad = 28
    const base = api.screenToFlowPosition({
      x: rect.left + pad,
      y: rect.top + pad,
    })
    // 已有节点太近则斜向错开，避免重叠
    let { x, y } = base
    const occupied = nodes.value.map((n) => n.position)
    for (let i = 0; i < 24; i++) {
      const hit = occupied.some(
        (p) => Math.abs(p.x - x) < 16 && Math.abs(p.y - y) < 16,
      )
      if (!hit) break
      x += 28
      y += 28
    }
    return { x, y }
  }
  // 无视口时：在已有包围盒左上外侧
  if (nodes.value.length === 0) return { x: 40, y: 40 }
  let minX = Infinity
  let minY = Infinity
  for (const n of nodes.value) {
    minX = Math.min(minX, n.position.x)
    minY = Math.min(minY, n.position.y)
  }
  return { x: minX, y: Math.max(0, minY - 140) }
}

function sortNodesVertical(list: AgentFlowNode[]): AgentFlowNode[] {
  return [...list].sort((a, b) => {
    const dy = a.position.y - b.position.y
    if (Math.abs(dy) > 8) return dy
    return a.position.x - b.position.x
  })
}

function clearEdges() {
  if (!interactive.value) return
  flowEdges.value = []
  selectedEdgeCount.value = 0
  emitGraphFromFlow()
}

function chainByVerticalOrder() {
  if (!interactive.value) return
  flowEdges.value = buildChainEdges(
    sortNodesVertical(nodes.value).map((n) => n.id),
  )
  selectedEdgeCount.value = 0
  emitGraphFromFlow()
}

function deleteSelectedEdges() {
  if (!interactive.value) return
  const next = flowEdges.value.filter((e) => !e.selected)
  if (next.length === flowEdges.value.length) return
  flowEdges.value = next
  selectedEdgeCount.value = 0
  emitGraphFromFlow()
}

defineExpose({
  clearEdges,
  chainByVerticalOrder,
  deleteSelectedEdges,
  selectedEdgeCount,
  getPlacementPosition,
})

const empty = computed(() => props.steps.length === 0)

const previewStyle = computed(() => {
  if (!isPreview.value) return undefined
  const n = Math.max(props.steps.length, 1)
  const px = Math.min(Math.max(56 + n * 108, 260), 760)
  return { height: `${px}px` }
})

watch(previewStyle, () => {
  requestAnimationFrame(() => scheduleFitView())
})
</script>

<template>
  <div
    ref="rootEl"
    class="agent-flow-canvas"
    :class="{
      'agent-flow-canvas--preview': isPreview,
      'agent-flow-canvas--edit': !isPreview,
      'agent-flow-canvas--disabled': disabled && !isPreview,
    }"
    :style="previewStyle"
  >
    <p
      v-if="empty"
      class="agent-flow-canvas__empty text-caption text-medium-emphasis"
    >
      {{ $t('settings.agent.graphEmpty') }}
    </p>
    <VueFlow
      v-model:nodes="nodes"
      v-model:edges="flowEdges"
      :node-types="nodeTypes"
      :nodes-draggable="interactive"
      :nodes-connectable="interactive"
      :elements-selectable="interactive"
      :edges-focusable="interactive"
      :delete-key-code="interactive ? ['Backspace', 'Delete'] : null"
      :default-edge-options="{
        selectable: true,
        focusable: true,
        deletable: true,
        interactionWidth: 24,
      }"
      :pan-on-drag="!isPreview"
      :zoom-on-scroll="!isPreview"
      :zoom-on-pinch="!isPreview"
      :zoom-on-double-click="!isPreview"
      :fit-view="isPreview"
      :fit-view-options="fitViewOptions()"
      :min-zoom="0.05"
      :max-zoom="isPreview ? 1.35 : 1.5"
      :pro-options="{ hideAttribution: true }"
      class="agent-flow-canvas__flow"
      @init="onInit"
      @connect="onConnect"
      @edges-change="onEdgesChange"
      @node-drag-stop="emitGraphFromFlow"
    >
      <Background :gap="isPreview ? 14 : 18" />
      <Controls v-if="!isPreview" :show-interactive="false" />
    </VueFlow>
  </div>
</template>

<style scoped>
.agent-flow-canvas {
  position: relative;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 0.5rem;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}
.agent-flow-canvas--preview {
  min-height: 16rem;
}
.agent-flow-canvas--edit {
  width: 100%;
  height: 100%;
  min-height: 12rem;
}
.agent-flow-canvas--disabled {
  opacity: 0.72;
}
.agent-flow-canvas__flow {
  width: 100%;
  height: 100%;
}
.agent-flow-canvas--preview :deep(.vue-flow__pane) {
  cursor: default;
}
.agent-flow-canvas--edit :deep(.vue-flow__edge.selected .vue-flow__edge-path) {
  stroke: rgb(var(--v-theme-error));
  stroke-width: 2.5;
}
.agent-flow-canvas__empty {
  position: absolute;
  z-index: 2;
  left: 0.75rem;
  top: 0.75rem;
  margin: 0;
  pointer-events: none;
}
</style>
