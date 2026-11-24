import type { AgentToolDefinition } from './types.js'
import { registerAgentTool, unregisterAgentTool } from './tool-registry.js'

export const FIXTURE_ECHO_TOOL_NAME = 'fixture_echo'

export const fixtureEchoToolDefinition: AgentToolDefinition = {
  type: 'function',
  function: {
    name: FIXTURE_ECHO_TOOL_NAME,
    description: 'Echo args back as JSON (test/fixture only)',
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      additionalProperties: true,
    },
  },
}

/** 注册 fixture_echo；返回卸载函数 */
export function registerFixtureEchoTool(): () => void {
  registerAgentTool(
    FIXTURE_ECHO_TOOL_NAME,
    async (argsJson) => {
      let parsed: unknown = argsJson
      try {
        parsed = JSON.parse(argsJson) as unknown
      } catch {
        parsed = { raw: argsJson }
      }
      return JSON.stringify({ ok: true, echo: parsed })
    },
    fixtureEchoToolDefinition,
  )
  return () => unregisterAgentTool(FIXTURE_ECHO_TOOL_NAME)
}
