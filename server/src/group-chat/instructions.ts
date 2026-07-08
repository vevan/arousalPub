import {
  DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION,
  DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION,
  normalizeGroupChatSettings,
  type GroupChatSettings,
} from '../shared/group-chat-settings.js'

function resolveGroupAssembleInstructionText(settings: GroupChatSettings): string {
  const custom = settings.groupAssembleInstruction?.trim()
  return custom || DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION
}

function resolveContinueAssembleInstructionText(
  settings: GroupChatSettings,
): string {
  const custom = settings.continueAssembleInstruction?.trim()
  return custom || DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION
}

function resolveAssembleInstructionText(
  settings: GroupChatSettings,
): string | null {
  const group = resolveGroupAssembleInstructionText(settings)
  const mode = settings.speakerMode ?? 'dice'
  if (mode === 'next@') {
    const cont = resolveContinueAssembleInstructionText(settings)
    return `${group}\n${cont}`
  }
  return group
}

/** 群聊 assemble 注入 user 消息之后；next@ 模式拼接群聊 + 接续说明 */
export function groupChatAssembleInstruction(
  settings: GroupChatSettings,
): string | null {
  const groupChat = normalizeGroupChatSettings(settings)
  if (!groupChat.enabled) return null
  return resolveAssembleInstructionText(groupChat)
}
