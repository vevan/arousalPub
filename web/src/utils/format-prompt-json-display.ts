/** 调试展示：保留 JSON 键值结构，多行字符串值不 JSON 转义 */

/** 单行标准 JSON 引号；多行用首尾引号包裹，中间保持真实换行（非 \\n 转义） */
function formatContentValue(value: string, inner: string): string {
  if (!value.includes('\n')) {
    return `${inner}"content": ${JSON.stringify(value)}`
  }
  const bodyIndent = `${inner}  `
  const body = value
    .split('\n')
    .map((line) => bodyIndent + line)
    .join('\n')
  return `${inner}"content": "\n${body}\n${inner}"`
}

function formatMessage(
  msg: { role: string; content: string },
  indent: string,
): string {
  const inner = `${indent}  `
  const roleLine = `${inner}"role": ${JSON.stringify(msg.role)}`
  const contentLine = formatContentValue(msg.content, inner)
  return `${indent}{\n${roleLine},\n${contentLine}\n${indent}}`
}

/** 格式化为 JSON 数组（用于组装预览等） */
export function formatChatMessagesForDisplay(
  messages: { role: string; content: string }[],
): string {
  if (messages.length === 0) return '[]'
  const items = messages.map((m) => formatMessage(m, '  '))
  return `[\n${items.join(',\n')}\n]`
}

export function formatAuditEntryForDisplay(entry: {
  savedAt: string
  chunkName: string
  turnId: string
  turnOrdinal: number
  messages: { role: string; content: string }[]
  assembly?: Record<string, unknown>
  calls?: unknown[]
  plugins?: unknown[]
}): string {
  const messageItems = entry.messages.map((m) => formatMessage(m, '    '))
  const messagesBlock =
    messageItems.length > 0
      ? `[\n${messageItems.join(',\n')}\n  ]`
      : '[]'
  const parts: string[] = [
    [
      '{',
      `  "savedAt": ${JSON.stringify(entry.savedAt)},`,
      `  "chunkName": ${JSON.stringify(entry.chunkName)},`,
      `  "turnId": ${JSON.stringify(entry.turnId)},`,
      `  "turnOrdinal": ${entry.turnOrdinal},`,
      `  "messages": ${messagesBlock}`,
      '}',
    ].join('\n'),
  ]
  if (entry.assembly) {
    parts.push(
      '\n--- assembly ---\n' + JSON.stringify(entry.assembly, null, 2),
    )
  }
  if (entry.calls?.length) {
    parts.push('\n--- calls ---\n' + JSON.stringify(entry.calls, null, 2))
  }
  if (entry.plugins?.length) {
    parts.push('\n--- plugins ---\n' + JSON.stringify(entry.plugins, null, 2))
  }
  return parts.join('')
}
