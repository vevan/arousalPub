<script setup lang="ts">
import AgentFlowCanvas from '@/components/settings/AgentFlowCanvas.vue'
import { useAgentSettingsStore } from '@/stores/agent-settings'
import type {
  AgentFlowEdgeConfig,
  AgentFlowPositions,
  AgentNodeCatalogEntry,
  AgentPipelineStepConfig,
  AgentToolCatalogEntry,
} from '@/types/agent-settings'
import { stepNodeId, validateMainPathLocal } from '@/utils/agent-flow-graph'
import { readPluginLocaleMessage } from '@/utils/plugin-locale-text'
import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, toRaw, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const { t, te } = useI18n()
const store = useAgentSettingsStore()
const {
  loading,
  saving,
  errorText,
  settings,
  tools,
  nodes: catalogNodes,
  usingDefaultPipeline,
  effectiveSteps,
  effectiveEdges,
  effectivePositions,
} = storeToRefs(store)

const nodeFilter = ref('')
const paletteOpen = ref(['system', 'control', 'plugin'])
const localSteps = ref<AgentPipelineStepConfig[]>([])
const localEdges = ref<AgentFlowEdgeConfig[]>([])
const localPositions = ref<AgentFlowPositions>({})
const editCanvasRef = ref<{
  clearEdges: () => void
  chainByVerticalOrder: () => void
  deleteSelectedEdges: () => void
  selectedEdgeCount: { value: number }
  getPlacementPosition: () => { x: number; y: number }
} | null>(null)
const graphEditorOpen = ref(false)
const resetConfirmOpen = ref(false)
const editOpen = ref(false)
const editIndex = ref<number | null>(null)
const editDraft = ref<AgentPipelineStepConfig | null>(null)
const editUnlimited = ref(false)
const editError = ref('')
const stepsDirty = ref(false)

/** Vue Proxy 无法 structuredClone；步骤为纯 JSON 形 */
function cloneSteps(
  steps: AgentPipelineStepConfig[],
): AgentPipelineStepConfig[] {
  return JSON.parse(JSON.stringify(toRaw(steps))) as AgentPipelineStepConfig[]
}

function cloneStep(step: AgentPipelineStepConfig): AgentPipelineStepConfig {
  return JSON.parse(JSON.stringify(toRaw(step))) as AgentPipelineStepConfig
}

const agentModeOn = computed({
  get: () => settings.value?.agentMode === 'on',
  set: (v: boolean | null) => {
    void store.setAgentMode(v === true ? 'on' : 'off')
  },
})

const activatedToolNames = computed(() => {
  const set = new Set<string>()
  for (const s of localSteps.value) {
    if (s.kind === 'tool') set.add(s.toolName)
  }
  return set
})

const filterQ = computed(() => nodeFilter.value.trim().toLowerCase())

function matchQ(name: string, desc = ''): boolean {
  const q = filterQ.value
  if (!q) return true
  return name.toLowerCase().includes(q) || desc.toLowerCase().includes(q)
}

const systemTools = computed(() =>
  tools.value.filter((t) => t.source === 'core' && matchQ(t.name, t.description)),
)
const pluginTools = computed(() =>
  tools.value.filter(
    (t) => t.source === 'plugin' && matchQ(t.name, t.description),
  ),
)
const pluginNodes = computed(() =>
  (catalogNodes.value ?? []).filter(
    (n: AgentNodeCatalogEntry) =>
      matchQ(n.type, n.description) || matchQ(n.title ?? ''),
  ),
)
const selectedEdgeCount = computed(
  () => editCanvasRef.value?.selectedEdgeCount?.value ?? 0,
)
const showBranchPalette = computed(() =>
  matchQ('if', t('settings.agent.branchNode')) ||
  matchQ('else', t('settings.agent.branchNode')) ||
  matchQ('branch', t('settings.agent.branchNode')) ||
  matchQ(t('settings.agent.branchNode')),
)

function syncLocalFromStore() {
  localSteps.value = cloneSteps(effectiveSteps.value)
  localEdges.value = JSON.parse(
    JSON.stringify(toRaw(effectiveEdges.value ?? [])),
  ) as AgentFlowEdgeConfig[]
  localPositions.value = JSON.parse(
    JSON.stringify(toRaw(effectivePositions.value ?? {})),
  ) as AgentFlowPositions
  // 禁止无边时按 steps 数组静默串链；边由服务端种子或用户手连
  stepsDirty.value = false
  errorText.value = ''
}

function openGraphEditor() {
  ensureSkeleton()
  graphEditorOpen.value = true
}

function requestResetDefault() {
  resetConfirmOpen.value = true
}

function confirmResetDefault() {
  resetConfirmOpen.value = false
  resetToDefaultPipeline()
}

watch([effectiveSteps, settings], () => {
  if (!stepsDirty.value) syncLocalFromStore()
})

onMounted(async () => {
  await store.load()
  syncLocalFromStore()
})

function proseIndex(): number {
  return localSteps.value.findIndex((s) => s.kind === 'prose')
}

/** 保证 start / prose / end 各一枚；不重排、不自动连边 */
function ensureSkeleton(): void {
  const hasStart = localSteps.value.some((s) => s.kind === 'start')
  const hasEnd = localSteps.value.some((s) => s.kind === 'end')
  const hasProse = proseIndex() >= 0
  const next = [...localSteps.value]
  if (!hasStart) next.unshift({ kind: 'start' })
  if (!hasProse) next.push({ kind: 'prose' })
  if (!hasEnd) next.push({ kind: 'end' })
  localSteps.value = next
}

function phaseOf(name: string): 'read' | 'write' | undefined {
  return tools.value.find((t) => t.name === name)?.phase
}

function resolveToolUiTitle(entry: AgentToolCatalogEntry): string {
  if (entry.source === 'core') {
    const key = `settings.agent.catalog.${entry.name}.title`
    if (te(key)) return t(key)
  }
  if (entry.pluginId && entry.uiTitleKey) {
    return (
      readPluginLocaleMessage(entry.pluginId, entry.uiTitleKey)?.trim() ||
      entry.name
    )
  }
  return entry.name
}

function resolveToolUiDescription(entry: AgentToolCatalogEntry): string {
  if (entry.source === 'core') {
    const key = `settings.agent.catalog.${entry.name}.desc`
    if (te(key)) return t(key)
  }
  if (entry.pluginId && entry.uiDescriptionKey) {
    return (
      readPluginLocaleMessage(entry.pluginId, entry.uiDescriptionKey)?.trim() ||
      ''
    )
  }
  return ''
}

function resolveNodeUiTitle(entry: AgentNodeCatalogEntry): string {
  if (entry.titleKey) {
    const loc = readPluginLocaleMessage(entry.pluginId, entry.titleKey)?.trim()
    if (loc) return loc
  }
  return entry.title?.trim() || entry.type
}

function resolveNodeUiDescription(entry: AgentNodeCatalogEntry): string {
  if (entry.descriptionKey) {
    return (
      readPluginLocaleMessage(entry.pluginId, entry.descriptionKey)?.trim() ||
      ''
    )
  }
  return entry.description?.trim() || ''
}

function isGeneratedToolTitle(title: string, toolName: string): boolean {
  const s = title.trim()
  if (!s || s === toolName) return true
  if (s.includes('·') && s.includes(toolName)) return true
  if (/^Required search/i.test(s)) return true
  if (/^(Read|Write)\s*·/i.test(s)) return true
  return false
}

/** 画布标题：用户自定义优先；生成态英文 title 忽略，改用人机 i18n */
function labelOf(step: AgentPipelineStepConfig): string {
  if (step.kind === 'start') return t('settings.agent.startNode')
  if (step.kind === 'end') return t('settings.agent.endNode')
  if (step.kind === 'prose') return t('settings.agent.proseNode')
  if (step.kind === 'branch') {
    const custom = step.title?.trim()
    if (custom && custom !== 'Condition (If / Else)' && custom !== '条件 (If / Else)') {
      return custom
    }
    return t('settings.agent.branchNode')
  }
  if (step.kind === 'tool') {
    const entry = tools.value.find((x) => x.name === step.toolName)
    const ui = entry ? resolveToolUiTitle(entry) : step.toolName
    const custom = step.title?.trim()
    if (custom && !isGeneratedToolTitle(custom, step.toolName)) return custom
    return ui
  }
  if (step.kind === 'node') {
    const entry = catalogNodes.value.find(
      (n) => n.pluginId === step.pluginId && n.type === step.type,
    )
    const ui = entry ? resolveNodeUiTitle(entry) : step.type
    const custom = step.title?.trim()
    if (
      custom &&
      custom !== step.type &&
      custom !== 'Trace exists' &&
      custom !== entry?.title
    ) {
      return custom
    }
    return ui
  }
  return ''
}

/** 编辑弹窗人机简介（非模型 description） */
function uiDescriptionOf(step: AgentPipelineStepConfig): string {
  if (step.kind === 'tool') {
    const entry = tools.value.find((x) => x.name === step.toolName)
    return entry ? resolveToolUiDescription(entry) : ''
  }
  if (step.kind === 'node') {
    const entry = catalogNodes.value.find(
      (n) => n.pluginId === step.pluginId && n.type === step.type,
    )
    return entry ? resolveNodeUiDescription(entry) : ''
  }
  if (step.kind === 'prose') return t('settings.agent.proseNodeHint')
  if (step.kind === 'start') return t('settings.agent.startNodeHint')
  if (step.kind === 'end') return t('settings.agent.endNodeHint')
  if (step.kind === 'branch') return t('settings.agent.branchNodeHint')
  return ''
}

const editCatalogDescription = computed(() => {
  const d = editDraft.value
  if (!d) return ''
  return uiDescriptionOf(d).trim()
})

function validateLocal(
  steps: AgentPipelineStepConfig[],
  edges: AgentFlowEdgeConfig[],
): string | null {
  if (steps.length === 0) return null
  const seenTools = new Set<string>()
  const seenBranch = new Set<string>()
  const seenNodeIds = new Set<string>()
  for (const s of steps) {
    if (s.kind === 'tool') {
      if (seenTools.has(s.toolName)) return t('settings.agent.errDuplicateTool')
      seenTools.add(s.toolName)
    } else if (s.kind === 'branch') {
      if (seenBranch.has(s.id)) return t('settings.agent.errDuplicateBranch')
      seenBranch.add(s.id)
    } else if (s.kind === 'node') {
      if (seenNodeIds.has(s.id)) return t('settings.agent.errDuplicateNodeId')
      seenNodeIds.add(s.id)
    }
  }
  const pathResult = validateMainPathLocal(steps, edges)
  if ('error' in pathResult) return t(`settings.agent.${pathResult.error}`)
  const onPath = new Set(pathResult.pathIds)
  const knownNodes = new Set(
    (catalogNodes.value ?? []).map((n) => `${n.pluginId}:${n.type}`),
  )
  for (const s of steps) {
    const id = stepNodeId(s)
    if (!onPath.has(id)) continue
    if (s.kind === 'tool' && !phaseOf(s.toolName)) {
      return t('settings.agent.errUnknownTool', { name: s.toolName })
    }
    if (s.kind === 'node') {
      const key = `${s.pluginId}:${s.type}`
      if (knownNodes.size > 0 && !knownNodes.has(key)) {
        return t('settings.agent.errUnknownNode', { name: s.type })
      }
    }
  }
  return null
}

async function persistGraph(payload?: {
  steps: AgentPipelineStepConfig[]
  edges: AgentFlowEdgeConfig[]
  positions?: AgentFlowPositions
}): Promise<boolean> {
  const steps = payload?.steps ?? localSteps.value
  const edges = payload?.edges ?? localEdges.value
  const positions = payload?.positions ?? localPositions.value
  const err = validateLocal(steps, edges)
  if (err) {
    errorText.value = err
    return false
  }
  const ok = await store.saveGraph({ steps, edges, positions })
  if (ok) {
    stepsDirty.value = false
    if (payload) {
      if (steps.length === 0) {
        syncLocalFromStore()
      } else {
        localSteps.value = cloneSteps(steps)
        localEdges.value = JSON.parse(
          JSON.stringify(edges),
        ) as AgentFlowEdgeConfig[]
        localPositions.value = JSON.parse(
          JSON.stringify(positions),
        ) as AgentFlowPositions
      }
    }
  }
  return ok
}

function placeStep(step: AgentPipelineStepConfig): AgentFlowPositions {
  const id = stepNodeId(step)
  const pos =
    editCanvasRef.value?.getPlacementPosition?.() ?? { x: 40, y: 40 }
  return { ...localPositions.value, [id]: pos }
}

function activateTool(tool: AgentToolCatalogEntry) {
  if (activatedToolNames.value.has(tool.name)) return
  ensureSkeleton()
  const step: AgentPipelineStepConfig = {
    kind: 'tool',
    toolName: tool.name,
    required: tool.source === 'core',
    maxCalls:
      !Number.isFinite(tool.maxCallsPerTurn) || tool.maxCallsPerTurn > 32
        ? 'unlimited'
        : tool.maxCallsPerTurn,
  }
  // 新工具默认为孤儿，由用户连入主路径
  const next = [...localSteps.value, step]
  const positions = placeStep(step)
  localSteps.value = next
  localPositions.value = positions
  stepsDirty.value = true
  void persistGraph({
    steps: next,
    edges: localEdges.value,
    positions,
  })
}

function addBranchNode() {
  ensureSkeleton()
  const id = `br_${Date.now().toString(36)}`
  const step: AgentPipelineStepConfig = {
    kind: 'branch',
    id,
    predicate: { type: 'prev_node_ok', ok: true },
  }
  const next = [...localSteps.value, step]
  const positions = placeStep(step)
  localSteps.value = next
  localPositions.value = positions
  stepsDirty.value = true
  void persistGraph({
    steps: next,
    edges: localEdges.value,
    positions,
  })
}

function addPluginNode(entry: AgentNodeCatalogEntry) {
  ensureSkeleton()
  const id = `nd_${Date.now().toString(36)}`
  const step: AgentPipelineStepConfig = {
    kind: 'node',
    id,
    type: entry.type,
    pluginId: entry.pluginId,
  }
  const next = [...localSteps.value, step]
  const positions = placeStep(step)
  localSteps.value = next
  localPositions.value = positions
  stepsDirty.value = true
  void persistGraph({
    steps: next,
    edges: localEdges.value,
    positions,
  })
}

function removeStep(index: number) {
  const s = localSteps.value[index]
  if (!s || s.kind === 'prose' || s.kind === 'start' || s.kind === 'end') {
    return
  }
  const snapshot = {
    steps: cloneSteps(localSteps.value),
    edges: JSON.parse(JSON.stringify(localEdges.value)) as AgentFlowEdgeConfig[],
    positions: JSON.parse(
      JSON.stringify(localPositions.value),
    ) as AgentFlowPositions,
  }
  const removedId = stepNodeId(s)
  const next = localSteps.value.filter((_, i) => i !== index)
  const edges = localEdges.value.filter(
    (e) => e.source !== removedId && e.target !== removedId,
  )
  const positions = { ...localPositions.value }
  delete positions[removedId]
  localSteps.value = next
  localEdges.value = edges
  localPositions.value = positions
  stepsDirty.value = true
  const err = validateLocal(next, edges)
  if (err) {
    // 删断主路径：保留本地 dirty 以便重连，不回滚、不自动 PUT
    errorText.value = err
    return
  }
  errorText.value = ''
  void persistGraph({ steps: next, edges, positions }).then((ok) => {
    if (!ok) {
      localSteps.value = snapshot.steps
      localEdges.value = snapshot.edges
      localPositions.value = snapshot.positions
    }
  })
}

function onCanvasGraph(payload: {
  steps: AgentPipelineStepConfig[]
  edges: AgentFlowEdgeConfig[]
  positions: AgentFlowPositions
}) {
  // 始终接受本地布局/连线，便于断边后重连；仅合法时自动落盘
  localSteps.value = payload.steps
  localEdges.value = payload.edges
  localPositions.value = payload.positions
  stepsDirty.value = true
  const err = validateLocal(payload.steps, payload.edges)
  if (err) {
    errorText.value = err
    return
  }
  errorText.value = ''
  void persistGraph(payload)
}

function openEdit(index: number) {
  const s = localSteps.value[index]
  if (!s) return
  editIndex.value = index
  editDraft.value = cloneStep(s)
  if (s.kind === 'tool') {
    editUnlimited.value = s.maxCalls === 'unlimited'
    if (s.maxCalls === null || s.maxCalls === undefined) {
      editDraft.value = { ...s, maxCalls: null }
    }
  } else {
    editUnlimited.value = false
  }
  editError.value = ''
  editOpen.value = true
}

function saveEdit() {
  const draft = editDraft.value
  const idx = editIndex.value
  if (!draft || idx === null) return
  if (draft.kind === 'tool') {
    if (editUnlimited.value) {
      draft.maxCalls = 'unlimited'
    } else if (
      typeof draft.maxCalls === 'number' &&
      Number.isFinite(draft.maxCalls)
    ) {
      const n = Math.round(draft.maxCalls)
      if (n < 1) {
        editError.value = t('settings.agent.errMaxCalls')
        return
      }
      draft.maxCalls = Math.min(32, n)
    } else {
      draft.maxCalls = null
    }
  }
  if (
    draft.kind === 'branch' &&
    draft.predicate?.type === 'prev_tool_code' &&
    !draft.predicate.equals.trim()
  ) {
    editError.value = t('settings.agent.errBranchCode')
    return
  }
  const next = [...localSteps.value]
  next[idx] = draft
  const err = validateLocal(next, localEdges.value)
  if (err) {
    editError.value = err
    return
  }
  localSteps.value = next
  editOpen.value = false
  stepsDirty.value = true
  void persistGraph({
    steps: next,
    edges: localEdges.value,
    positions: localPositions.value,
  })
}

function resetToDefaultPipeline() {
  // 落盘空文档 → GET 用最小种子 + usingDefault；禁止写回旧多工具链
  stepsDirty.value = true
  void persistGraph({ steps: [], edges: [], positions: {} }).then((ok) => {
    if (ok) syncLocalFromStore()
  })
}
</script>

<template>
  <div class="agent-settings">
    <div class="d-flex align-center flex-wrap ga-3 mb-2">
      <div class="text-h6">{{ $t('settings.agent.title') }}</div>
      <v-spacer />
      <v-switch
        v-model="agentModeOn"
        color="primary"
        density="compact"
        hide-details
        :loading="saving"
        :disabled="loading"
        :label="$t('settings.agent.mode')"
      />
    </div>
    <p class="text-medium-emphasis text-body-2 mb-4">
      {{ $t('settings.agent.modeHint') }}
    </p>

    <v-alert
      v-if="errorText"
      type="error"
      density="compact"
      variant="tonal"
      class="mb-3"
      closable
      @click:close="errorText = ''"
    >
      {{ errorText }}
    </v-alert>

    <v-alert
      v-if="usingDefaultPipeline && !stepsDirty"
      type="info"
      density="compact"
      variant="tonal"
      class="mb-3"
    >
      {{ $t('settings.agent.usingDefault') }}
    </v-alert>

    <v-progress-linear v-if="loading" indeterminate class="mb-3" />

    <v-card variant="outlined" class="pa-3">
      <div class="d-flex align-center mb-2">
        <div class="text-subtitle-2">
          {{ $t('settings.agent.activePipeline') }}
        </div>
        <v-spacer />
        <v-btn
          size="small"
          color="primary"
          variant="tonal"
          :disabled="loading"
          @click="openGraphEditor"
        >
          {{ $t('settings.agent.editGraph') }}
        </v-btn>
        <v-btn
          size="small"
          variant="outlined"
          color="error"
          class="ms-4"
          :disabled="saving || (usingDefaultPipeline && !stepsDirty)"
          @click="requestResetDefault"
        >
          {{ $t('settings.agent.resetDefault') }}
        </v-btn>
      </div>
      <p class="text-caption text-medium-emphasis mb-2">
        {{ $t('settings.agent.pipelineHint') }}
      </p>
      <AgentFlowCanvas
        mode="preview"
        :steps="localSteps"
        :edges="localEdges"
        :positions="localPositions"
        :phase-of="phaseOf"
        :label-of="labelOf"
      />
    </v-card>

    <v-dialog
      v-model="graphEditorOpen"
      content-class="agent-graph-dialog-surface"
      scrim="true"
      persistent
    >
      <v-card class="agent-graph-dialog d-flex flex-column">
        <v-toolbar density="comfortable" color="surface" class="flex-grow-0">
          <v-toolbar-title>{{ $t('settings.agent.editGraphTitle') }}</v-toolbar-title>
          <v-spacer />
          <v-btn
            size="small"
            variant="text"
            :disabled="saving || selectedEdgeCount < 1"
            @click="editCanvasRef?.deleteSelectedEdges()"
          >
            {{ $t('settings.agent.deleteSelectedEdges') }}
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            :disabled="saving || localEdges.length === 0"
            @click="editCanvasRef?.clearEdges()"
          >
            {{ $t('settings.agent.clearEdges') }}
          </v-btn>
          <v-btn
            size="small"
            variant="text"
            :disabled="saving || localSteps.length < 2"
            @click="editCanvasRef?.chainByVerticalOrder()"
          >
            {{ $t('settings.agent.chainByOrder') }}
          </v-btn>
          <v-btn
            size="small"
            variant="outlined"
            color="error"
            class="ms-2"
            :disabled="saving || (usingDefaultPipeline && !stepsDirty)"
            @click="requestResetDefault"
          >
            {{ $t('settings.agent.resetDefault') }}
          </v-btn>
          <v-btn
            icon="mdi-close"
            :aria-label="$t('settings.agent.closeGraphEditor')"
            @click="graphEditorOpen = false"
          />
        </v-toolbar>
        <div class="agent-graph-dialog__body">
          <aside class="agent-graph-dialog__tools">
            <div class="text-subtitle-2 mb-2">
              {{ $t('settings.agent.availableNodes') }}
            </div>
            <p class="text-caption text-medium-emphasis mb-2">
              {{ $t('settings.agent.graphEditorHint') }}
            </p>
            <v-text-field
              v-model="nodeFilter"
              density="compact"
              hide-details
              clearable
              single-line
              class="mb-2 agent-graph-dialog__tool-search"
              :placeholder="$t('settings.agent.searchNodes')"
            />
            <v-expansion-panels
              v-model="paletteOpen"
              multiple
              variant="accordion"
              class="agent-graph-dialog__palette"
            >
              <v-expansion-panel value="system">
                <v-expansion-panel-title>
                  {{ $t('settings.agent.paletteSystem') }}
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <v-list density="compact">
                    <v-list-item
                      v-for="tool in systemTools"
                      :key="tool.name"
                      :disabled="activatedToolNames.has(tool.name)"
                    >
                      <v-list-item-title>
                        {{ resolveToolUiTitle(tool) }}
                      </v-list-item-title>
                      <v-list-item-subtitle>
                        {{
                          tool.phase === 'write'
                            ? $t('settings.agent.phaseWrite')
                            : $t('settings.agent.phaseRead')
                        }}
                        · {{ resolveToolUiDescription(tool) || tool.name }}
                      </v-list-item-subtitle>
                      <template #append>
                        <v-btn
                          icon="mdi-plus"
                          size="small"
                          variant="text"
                          :disabled="activatedToolNames.has(tool.name) || saving"
                          @click="activateTool(tool)"
                        />
                      </template>
                    </v-list-item>
                  </v-list>
                </v-expansion-panel-text>
              </v-expansion-panel>
              <v-expansion-panel value="control">
                <v-expansion-panel-title>
                  {{ $t('settings.agent.paletteControl') }}
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <v-list density="compact">
                    <v-list-item v-if="showBranchPalette">
                      <v-list-item-title>
                        {{ $t('settings.agent.branchNode') }}
                      </v-list-item-title>
                      <v-list-item-subtitle>if / else</v-list-item-subtitle>
                      <template #append>
                        <v-btn
                          icon="mdi-plus"
                          size="small"
                          variant="text"
                          :disabled="saving"
                          @click="addBranchNode"
                        />
                      </template>
                    </v-list-item>
                    <v-list-item disabled>
                      <v-list-item-title>
                        {{ $t('settings.agent.controlComingSoon') }}
                      </v-list-item-title>
                    </v-list-item>
                  </v-list>
                </v-expansion-panel-text>
              </v-expansion-panel>
              <v-expansion-panel value="plugin">
                <v-expansion-panel-title>
                  {{ $t('settings.agent.palettePlugin') }}
                </v-expansion-panel-title>
                <v-expansion-panel-text>
                  <v-list density="compact">
                    <v-list-item
                      v-for="node in pluginNodes"
                      :key="`node:${node.pluginId}:${node.type}`"
                    >
                      <v-list-item-title>
                        {{ resolveNodeUiTitle(node) }}
                      </v-list-item-title>
                      <v-list-item-subtitle>
                        {{ $t('settings.agent.pluginNodeBadge') }} ·
                        {{ resolveNodeUiDescription(node) || node.type }}
                      </v-list-item-subtitle>
                      <template #append>
                        <v-btn
                          icon="mdi-plus"
                          size="small"
                          variant="text"
                          :disabled="saving"
                          @click="addPluginNode(node)"
                        />
                      </template>
                    </v-list-item>
                    <v-list-item
                      v-for="tool in pluginTools"
                      :key="`tool:${tool.name}`"
                      :disabled="activatedToolNames.has(tool.name)"
                    >
                      <v-list-item-title>
                        {{ resolveToolUiTitle(tool) }}
                      </v-list-item-title>
                      <v-list-item-subtitle>
                        {{ $t('settings.agent.pluginToolBadge') }} ·
                        {{
                          tool.phase === 'write'
                            ? $t('settings.agent.phaseWrite')
                            : $t('settings.agent.phaseRead')
                        }}
                        · {{ resolveToolUiDescription(tool) || tool.name }}
                      </v-list-item-subtitle>
                      <template #append>
                        <v-btn
                          icon="mdi-plus"
                          size="small"
                          variant="text"
                          :disabled="activatedToolNames.has(tool.name) || saving"
                          @click="activateTool(tool)"
                        />
                      </template>
                    </v-list-item>
                  </v-list>
                </v-expansion-panel-text>
              </v-expansion-panel>
            </v-expansion-panels>
          </aside>
          <div class="agent-graph-dialog__canvas-wrap">
            <AgentFlowCanvas
              v-if="graphEditorOpen"
              ref="editCanvasRef"
              mode="edit"
              :steps="localSteps"
              :edges="localEdges"
              :positions="localPositions"
              :phase-of="phaseOf"
              :label-of="labelOf"
              :disabled="saving"
              @update:graph="onCanvasGraph"
              @edit="openEdit"
              @remove="removeStep"
            />
          </div>
        </div>
      </v-card>
    </v-dialog>

    <v-dialog v-model="resetConfirmOpen" max-width="28rem">
      <v-card>
        <v-card-title>{{ $t('settings.agent.resetDefaultConfirmTitle') }}</v-card-title>
        <v-card-text>{{ $t('settings.agent.resetDefaultConfirmBody') }}</v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="resetConfirmOpen = false">
            {{ $t('settings.agent.cancel') }}
          </v-btn>
          <v-btn color="error" variant="flat" @click="confirmResetDefault">
            {{ $t('settings.agent.resetDefaultConfirm') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="editOpen" max-width="32rem">
      <v-card v-if="editDraft">
        <v-card-title>
          {{
            editDraft.kind === 'prose'
              ? $t('settings.agent.editProse')
              : editDraft.kind === 'branch'
                ? $t('settings.agent.editBranch')
                : editDraft.kind === 'node'
                  ? $t('settings.agent.editPluginNode')
                  : $t('settings.agent.editTool')
          }}
        </v-card-title>
        <v-card-text>
          <v-alert
            v-if="editError"
            type="error"
            density="compact"
            variant="tonal"
            class="mb-3"
          >
            {{ editError }}
          </v-alert>
          <template v-if="editDraft.kind === 'tool'">
            <div class="text-body-2 mb-1">
              {{ editDraft.toolName }}
            </div>
            <p
              v-if="editCatalogDescription"
              class="text-caption text-medium-emphasis mb-3"
            >
              {{ editCatalogDescription }}
            </p>
            <v-switch
              v-model="editDraft.required"
              density="compact"
              color="primary"
              :label="$t('settings.agent.fieldRequired')"
              hide-details
              class="mb-2"
            />
            <v-switch
              v-model="editUnlimited"
              density="compact"
              color="primary"
              :label="$t('settings.agent.fieldUnlimited')"
              hide-details
              class="mb-2"
            />
            <v-text-field
              v-if="!editUnlimited && editDraft.kind === 'tool'"
              :model-value="
                typeof editDraft.maxCalls === 'number' ? editDraft.maxCalls : ''
              "
              type="number"
              min="1"
              max="32"
              density="compact"
              clearable
              :label="$t('settings.agent.fieldMaxCalls')"
              :hint="$t('settings.agent.fieldMaxCallsHint')"
              persistent-hint
              class="mb-2"
              @update:model-value="
                (v) => {
                  if (editDraft && editDraft.kind === 'tool') {
                    if (v === '' || v === null || v === undefined) {
                      editDraft.maxCalls = null
                    } else {
                      const n = Number(v)
                      editDraft.maxCalls = Number.isFinite(n) ? n : null
                    }
                  }
                }
              "
            />
            <v-text-field
              v-model="editDraft.title"
              density="compact"
              :label="$t('settings.agent.fieldTitle')"
              class="mb-2"
            />
            <v-textarea
              v-model="editDraft.instruction"
              density="compact"
              rows="4"
              :label="$t('settings.agent.fieldInstruction')"
            />
          </template>
          <template v-else-if="editDraft.kind === 'branch'">
            <p
              v-if="editCatalogDescription"
              class="text-caption text-medium-emphasis mb-3"
            >
              {{ editCatalogDescription }}
            </p>
            <v-text-field
              v-model="editDraft.title"
              density="compact"
              :label="$t('settings.agent.fieldTitle')"
              class="mb-2"
            />
            <v-select
              :model-value="editDraft.predicate?.type ?? 'prev_node_ok'"
              :items="[
                {
                  title: $t('settings.agent.predPrevNodeOk'),
                  value: 'prev_node_ok',
                },
                {
                  title: $t('settings.agent.predPrevOk'),
                  value: 'prev_tool_ok',
                },
                {
                  title: $t('settings.agent.predPrevCode'),
                  value: 'prev_tool_code',
                },
              ]"
              density="compact"
              :label="$t('settings.agent.fieldPredicate')"
              class="mb-2"
              @update:model-value="
                (v) => {
                  if (!editDraft || editDraft.kind !== 'branch') return
                  if (v === 'prev_tool_code') {
                    editDraft.predicate = {
                      type: 'prev_tool_code',
                      equals:
                        editDraft.predicate?.type === 'prev_tool_code'
                          ? editDraft.predicate.equals
                          : '',
                    }
                  } else if (v === 'prev_node_ok') {
                    editDraft.predicate = {
                      type: 'prev_node_ok',
                      ok:
                        editDraft.predicate?.type === 'prev_node_ok'
                          ? editDraft.predicate.ok
                          : true,
                    }
                  } else {
                    editDraft.predicate = {
                      type: 'prev_tool_ok',
                      ok:
                        editDraft.predicate?.type === 'prev_tool_ok'
                          ? editDraft.predicate.ok
                          : true,
                    }
                  }
                }
              "
            />
            <v-switch
              v-if="
                editDraft.predicate?.type === 'prev_tool_ok' ||
                editDraft.predicate?.type === 'prev_node_ok'
              "
              v-model="editDraft.predicate.ok"
              density="compact"
              color="primary"
              :label="$t('settings.agent.predOkTrue')"
              hide-details
              class="mb-2"
            />
            <v-text-field
              v-if="editDraft.predicate?.type === 'prev_tool_code'"
              v-model="editDraft.predicate.equals"
              density="compact"
              :label="$t('settings.agent.predCodeEquals')"
              :hint="$t('settings.agent.predCodeHint')"
              persistent-hint
              class="mb-2"
            />
          </template>
          <template v-else-if="editDraft.kind === 'node'">
            <p class="text-body-2 mb-1">
              {{ editDraft.type }}
              <span class="text-medium-emphasis">
                ({{ editDraft.pluginId }})
              </span>
            </p>
            <p
              v-if="editCatalogDescription"
              class="text-caption text-medium-emphasis mb-3"
            >
              {{ editCatalogDescription }}
            </p>
            <v-text-field
              v-model="editDraft.title"
              density="compact"
              :label="$t('settings.agent.fieldTitle')"
              class="mb-2"
            />
          </template>
          <template v-else-if="editDraft.kind === 'prose'">
            <p
              v-if="editCatalogDescription"
              class="text-caption text-medium-emphasis mb-3"
            >
              {{ editCatalogDescription }}
            </p>
            <v-textarea
              v-model="editDraft.instruction"
              density="compact"
              rows="4"
              :label="$t('settings.agent.fieldInstruction')"
            />
          </template>
          <template v-else>
            <p
              v-if="editCatalogDescription"
              class="text-caption text-medium-emphasis mb-3"
            >
              {{ editCatalogDescription }}
            </p>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="editOpen = false">
            {{ $t('settings.agent.cancel') }}
          </v-btn>
          <v-btn color="primary" :loading="saving" @click="saveEdit">
            {{ $t('settings.agent.save') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.agent-graph-dialog {
  width: 100%;
  height: 100%;
  max-height: 100%;
  overflow: hidden;
}
.agent-graph-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: row;
  gap: 0.75rem;
  padding: 0.75rem 1rem 1rem;
  box-sizing: border-box;
}
.agent-graph-dialog__tools {
  width: 17rem;
  flex: 0 0 17rem;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 0.5rem;
  padding: 0.75rem;
  box-sizing: border-box;
}
.agent-graph-dialog__tool-search {
  flex: 0 0 auto;
  align-self: stretch;
  width: 100%;
  max-width: 100%;
}
.agent-graph-dialog__tool-search :deep(.v-input__control) {
  height: auto;
  min-height: 0;
}
.agent-graph-dialog__tool-search :deep(.v-field) {
  width: 100%;
  height: auto;
  min-height: 2.25rem;
}
.agent-graph-dialog__palette {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}
.agent-graph-dialog__canvas-wrap {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  height: 100%;
  position: relative;
}
.agent-graph-dialog__canvas-wrap :deep(.agent-flow-canvas) {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
</style>

