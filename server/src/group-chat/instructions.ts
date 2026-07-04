import {
  DEFAULT_GROUP_CHAT_ASSEMBLE_INSTRUCTION,
  DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION,
  normalizeGroupChatSettings,
  type GroupChatSettings,
} from '../shared/group-chat-settings.js'

/** @deprecated 历史内置文案，新逻辑见 group/continue 默认常量 */
export const GROUP_CHAT_SEQUENTIAL_INSTRUCTION =
  '本对话为群聊接龙：按绑定角色顺序轮流发言；同一角色不得连续两句；每位角色本回合发言次数有限。助手正文中的裸 @ 不会生效。'

/** @deprecated 历史内置文案，新逻辑见 group/continue 默认常量 */
export const GROUP_CHAT_DICE_INSTRUCTION =
  '本对话为群聊接龙：每段由系统掷骰决定下一位发言者，并非每位角色都会每轮发言；每位角色本回合发言次数有限。助手正文中的裸 @ 不会生效。'

/** @deprecated 历史内置文案，新逻辑见 DEFAULT_GROUP_CONTINUE_ASSEMBLE_INSTRUCTION */
export const GROUP_CHAT_NEXT_AT_INSTRUCTION =
  '若需其他角色接下一句，使用 [NEXT@角色名]，例如 [NEXT@Betty]。\n每个角色每轮发言次数有限；助手消息中的裸 @ 不会生效。'

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

/** @deprecated 使用 groupChatAssembleInstruction；仅 next@ 时非 null */
export function groupChatNextAtInstruction(
  settings: GroupChatSettings,
): string | null {
  const groupChat = normalizeGroupChatSettings(settings)
  if (!groupChat.enabled || groupChat.speakerMode !== 'next@') return null
  return resolveAssembleInstructionText(groupChat)
}
