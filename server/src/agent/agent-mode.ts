/** 会话 Agent 模式（DOC/devNotes/53 §1.0 · §10.2） */

export type AgentMode = 'off' | 'on'

export function normalizeAgentMode(raw: unknown): AgentMode {
  if (raw === 'on' || raw === true || raw === 1 || raw === '1') return 'on'
  return 'off'
}

export function isAgentModeOn(raw: unknown): boolean {
  return normalizeAgentMode(raw) === 'on'
}
