/** customParams 不得覆盖的顶层键（DOC/25 §6） */
export const CUSTOM_PARAMS_PROTECTED_KEYS = new Set([
  'messages',
  'model',
  'stream',
  'input',
  'prompt',
  'tools',
  'tool_choice',
  'thinking',
  'response_format',
])

/** 浅合并 customParams，跳过保护字段 */
export function mergeCustomParamsIntoPayload(
  payload: Record<string, unknown>,
  customParams: Record<string, unknown> | undefined,
): void {
  if (!customParams || typeof customParams !== 'object' || Array.isArray(customParams)) {
    return
  }
  for (const [key, value] of Object.entries(customParams)) {
    if (CUSTOM_PARAMS_PROTECTED_KEYS.has(key)) continue
    payload[key] = value
  }
}
