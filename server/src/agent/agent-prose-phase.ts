/**
 * Agent 读→正文→写：主泡 prose 提交门闩（DOC/53 §16）。
 * 宿主 generic：只认 tool 名是否 ∈ write 集合，不解析插件 id。
 */

export type AgentToolPhase = 'read' | 'write'

export type ProseToolCallsAction = 'clear' | 'commit' | 'keep'

export function normalizeAgentToolPhase(raw: unknown): AgentToolPhase | undefined {
  return raw === 'read' || raw === 'write' ? raw : undefined
}

/**
 * 在收到完整 tool_calls 进度（已有 name）时决定主泡动作。
 * - 已提交 → keep（永不 clear）
 * - 正文前检索未齐 → clear（含误夹 write 名的泄漏）
 * - 检索已齐且已有流式正文 → commit（write 或弱模型 prose 后补 read）
 */
export function decideToolCallsProseAction(opts: {
  proseCommitted: boolean
  contentChars: number
  toolNames: string[]
  writeToolNames: ReadonlySet<string>
  /** 绑定检索（若有）是否已全部成功调用 */
  preProseReadsDone?: boolean
}): ProseToolCallsAction {
  if (opts.proseCommitted) return 'keep'
  if (opts.contentChars <= 0) return 'clear'
  if (opts.preProseReadsDone !== true) return 'clear'
  return 'commit'
}
