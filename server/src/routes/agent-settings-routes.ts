/**
 * Agent 设置 API：全局单文档 + 工具目录。
 */

import type { FastifyInstance } from 'fastify'
import { ApiErrorCodes } from '../api-error-codes.js'
import { getCurrentUserId } from '../user-context.js'
import {
  AgentSettingsValidationError,
  parseAgentSettingsDocument,
  readAgentSettingsDocument,
  sanitizeAgentPipelineSteps,
  writeAgentSettingsDocument,
} from '../agent/agent-settings-file.js'
import { collectAgentNodeCatalog } from '../agent/agent-nodes-catalog.js'
import {
  catalogPhaseByTool,
  collectAgentToolCatalog,
} from '../agent/agent-tools-catalog.js'
import { compileAgentPipelinePolicyFromSteps } from '../agent/agent-settings-compile.js'
import { seedMinimalAgentGraph } from '../agent/agent-graph.js'

export function registerAgentSettingsRoutes(app: FastifyInstance): void {
  app.get('/api/agent-tools', async (_request, reply) => {
    try {
      const userId = getCurrentUserId()
      const tools = await collectAgentToolCatalog(userId)
      return { tools }
    } catch (e) {
      app.log.error(e)
      return reply
        .status(500)
        .send({ error: ApiErrorCodes.agent_tools_catalog_failed })
    }
  })

  app.get('/api/agent-settings', async (_request, reply) => {
    try {
      const userId = getCurrentUserId()
      const doc = await readAgentSettingsDocument(userId)
      const tools = await collectAgentToolCatalog(userId)
      const nodes = await collectAgentNodeCatalog(userId)
      const phaseByTool = catalogPhaseByTool(tools)
      const safeSteps = sanitizeAgentPipelineSteps(
        doc.steps,
        phaseByTool,
        doc.edges,
      )
      const usingMinimalSeed = safeSteps.length === 0
      const seed = seedMinimalAgentGraph()
      const settings = usingMinimalSeed
        ? {
            ...doc,
            steps: [],
            edges: undefined,
            positions: undefined,
          }
        : {
            ...doc,
            steps: safeSteps,
            edges: doc.edges,
            positions: doc.positions,
          }
      const effectiveSteps = usingMinimalSeed ? seed.steps : safeSteps
      const effectiveEdges = usingMinimalSeed ? seed.edges : (doc.edges ?? [])
      const policy = compileAgentPipelinePolicyFromSteps(
        effectiveSteps,
        tools.map((t) => ({
          name: t.name,
          phase: t.phase,
          maxCallsPerTurn: t.maxCallsPerTurn,
        })),
        effectiveEdges,
      )
      return {
        settings,
        tools,
        nodes,
        /** 未落盘自定义图时使用最小种子 start→prose→end */
        usingDefaultPipeline: usingMinimalSeed,
        effectiveSteps,
        effectiveEdges,
        effectivePositions: usingMinimalSeed ? seed.positions : doc.positions,
        policyPreview: policy,
      }
    } catch (e) {
      app.log.error(e)
      return reply
        .status(500)
        .send({ error: ApiErrorCodes.agent_settings_read_failed })
    }
  })

  app.put<{
    Body: {
      agentMode?: unknown
      steps?: unknown
      edges?: unknown
      positions?: unknown
    }
  }>('/api/agent-settings', async (request, reply) => {
    try {
      const userId = getCurrentUserId()
      const tools = await collectAgentToolCatalog(userId)
      const phaseByTool = catalogPhaseByTool(tools)
      const current = await readAgentSettingsDocument(userId)
      const safeCurrentSteps = sanitizeAgentPipelineSteps(
        current.steps,
        phaseByTool,
        current.edges,
      )
      const body = request.body ?? {}
      const nextRaw: Record<string, unknown> = {
        schemaVersion: 1,
        agentMode:
          body.agentMode !== undefined ? body.agentMode : current.agentMode,
        steps: body.steps !== undefined ? body.steps : safeCurrentSteps,
      }
      if (body.edges !== undefined) {
        nextRaw.edges = body.edges
      } else if (current.edges && safeCurrentSteps.length > 0) {
        nextRaw.edges = current.edges
      }
      if (body.positions !== undefined) {
        nextRaw.positions = body.positions
      } else if (current.positions && safeCurrentSteps.length > 0) {
        nextRaw.positions = current.positions
      }
      const parsed = parseAgentSettingsDocument(nextRaw, { phaseByTool })
      const saved = await writeAgentSettingsDocument(parsed, userId, {
        phaseByTool,
      })
      return { settings: saved }
    } catch (e) {
      if (e instanceof AgentSettingsValidationError) {
        return reply.status(400).send({
          error: ApiErrorCodes.agent_settings_validation_failed,
          detail: e.message,
        })
      }
      app.log.error(e)
      return reply
        .status(500)
        .send({ error: ApiErrorCodes.agent_settings_write_failed })
    }
  })
}
