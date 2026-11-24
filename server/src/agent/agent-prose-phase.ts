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
 * - 未提交且含 write、已有流式正文 → commit（同 step 正文后写）
 * - 其余 → clear（正文前 read / 未标注 tool）
 */
export function decideToolCallsProseAction(opts: {
  proseCommitted: boolean
  contentChars: number
  toolNames: string[]
  writeToolNames: ReadonlySet<string>
}): ProseToolCallsAction {
  if (opts.proseCommitted) return 'keep'
  const hasWrite = opts.toolNames.some((n) =>
    opts.writeToolNames.has(n.trim()),
  )
  if (hasWrite && opts.contentChars > 0) return 'commit'
  return 'clear'
}
