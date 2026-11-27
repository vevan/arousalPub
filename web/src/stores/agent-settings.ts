import { defineStore } from 'pinia'
import { ref } from 'vue'
import type {
  AgentFlowEdgeConfig,
  AgentFlowPositions,
  AgentMode,
  AgentNodeCatalogEntry,
  AgentPipelineStepConfig,
  AgentSettingsDocument,
  AgentSettingsGetResponse,
  AgentToolCatalogEntry,
} from '@/types/agent-settings'
import { apiFetch } from '@/utils/api-fetch'
import { translateApiError } from '@/utils/api-error-message'

export const useAgentSettingsStore = defineStore('agent-settings', () => {
  const loading = ref(false)
  const saving = ref(false)
  const errorText = ref('')
  const settings = ref<AgentSettingsDocument | null>(null)
  const tools = ref<AgentToolCatalogEntry[]>([])
  const nodes = ref<AgentNodeCatalogEntry[]>([])
  const usingDefaultPipeline = ref(true)
  const effectiveSteps = ref<AgentPipelineStepConfig[]>([])
  const effectiveEdges = ref<AgentFlowEdgeConfig[]>([])
  const effectivePositions = ref<AgentFlowPositions>({})

  async function load(): Promise<boolean> {
    loading.value = true
    errorText.value = ''
    try {
      const res = await apiFetch('/api/agent-settings')
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string }
        errorText.value = translateApiError(body.error ?? 'agent_settings_read_failed')
        return false
      }
      const data = (await res.json()) as AgentSettingsGetResponse
      settings.value = data.settings
      tools.value = data.tools ?? []
      nodes.value = data.nodes ?? []
      usingDefaultPipeline.value = data.usingDefaultPipeline === true
      effectiveSteps.value = data.effectiveSteps ?? []
      effectiveEdges.value = data.effectiveEdges ?? data.settings?.edges ?? []
      effectivePositions.value =
        data.effectivePositions ?? data.settings?.positions ?? {}
      return true
    } catch (e) {
      errorText.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      loading.value = false
    }
  }

  async function savePatch(patch: {
    agentMode?: AgentMode
    steps?: AgentPipelineStepConfig[]
    edges?: AgentFlowEdgeConfig[]
    positions?: AgentFlowPositions
  }): Promise<boolean> {
    saving.value = true
    errorText.value = ''
    try {
      const res = await apiFetch('/api/agent-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string
          detail?: string
        }
        errorText.value = translateApiError(
          body.detail ?? body.error ?? 'agent_settings_write_failed',
        )
        return false
      }
      const data = (await res.json()) as { settings: AgentSettingsDocument }
      settings.value = data.settings
      await load()
      return true
    } catch (e) {
      errorText.value = e instanceof Error ? e.message : String(e)
      return false
    } finally {
      saving.value = false
    }
  }

  async function setAgentMode(mode: AgentMode): Promise<boolean> {
    return savePatch({ agentMode: mode })
  }

  async function saveGraph(payload: {
    steps: AgentPipelineStepConfig[]
    edges?: AgentFlowEdgeConfig[]
    positions?: AgentFlowPositions
  }): Promise<boolean> {
    return savePatch({
      steps: payload.steps,
      edges: payload.edges ?? [],
      ...(payload.positions !== undefined
        ? { positions: payload.positions }
        : {}),
    })
  }

  return {
    loading,
    saving,
    errorText,
    settings,
    tools,
    nodes,
    usingDefaultPipeline,
    effectiveSteps,
    effectiveEdges,
    effectivePositions,
    load,
    savePatch,
    setAgentMode,
    saveGraph,
  }
})
