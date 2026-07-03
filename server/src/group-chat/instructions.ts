import {
  normalizeGroupChatSettings,
  type GroupChatSettings,
  type SpeakerMode,
} from '../shared/group-chat-settings.js'

export const GROUP_CHAT_NEXT_AT_INSTRUCTION =
  '若需其他角色接下一句，使用 [NEXT@角色名]，例如 [NEXT@Betty]。\n每个角色每轮发言次数有限；助手消息中的裸 @ 不会生效。'

export const GROUP_CHAT_SEQUENTIAL_INSTRUCTION =
  '本对话为群聊接龙：按绑定角色顺序轮流发言；同一角色不得连续两句；每位角色本回合发言次数有限。助手正文中的裸 @ 不会生效。'

export const GROUP_CHAT_DICE_INSTRUCTION =
  '本对话为群聊接龙：每段由系统掷骰决定下一位发言者，并非每位角色都会每轮发言；每位角色本回合发言次数有限。助手正文中的裸 @ 不会生效。'

const INSTRUCTION_BY_MODE: Record<SpeakerMode, string> = {
  sequential: GROUP_CHAT_SEQUENTIAL_INSTRUCTION,
  dice: GROUP_CHAT_DICE_INSTRUCTION,
  'next@': GROUP_CHAT_NEXT_AT_INSTRUCTION,
}

/** 群聊 assemble 注入 authorsNote：按 speakerMode 分支（G5） */
export function groupChatAssembleInstruction(
  settings: GroupChatSettings,
): string | null {
  const groupChat = normalizeGroupChatSettings(settings)
  if (!groupChat.enabled) return null
  return INSTRUCTION_BY_MODE[groupChat.speakerMode ?? 'dice']
}

/** @deprecated 使用 groupChatAssembleInstruction；仅 next@ 时非 null */
export function groupChatNextAtInstruction(
  settings: GroupChatSettings,
): string | null {
  const groupChat = normalizeGroupChatSettings(settings)
  if (!groupChat.enabled || groupChat.speakerMode !== 'next@') return null
  return GROUP_CHAT_NEXT_AT_INSTRUCTION
}
