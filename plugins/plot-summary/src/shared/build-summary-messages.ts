/** plot-summary 出站 complete 消息：参考块 → 待摘要 history → 摘要指令（末尾） */

export type SummaryCompleteMessage = {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 参考 system → user(history) → 摘要指令 system（置于最后） */
export function buildSummaryCompleteMessages(
  systemReferenceContext: string,
  userContent: string,
  systemPromptTemplate: string,
): SummaryCompleteMessage[] {
  const reference = systemReferenceContext.trim()
  const history = userContent.trim()
  const instruction = systemPromptTemplate.trim()
  const messages: SummaryCompleteMessage[] = []
  if (reference) messages.push({ role: 'system', content: reference })
  if (history) messages.push({ role: 'user', content: history })
  if (instruction) messages.push({ role: 'system', content: instruction })
  return messages
}
