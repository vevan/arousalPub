import type { TurnRecord } from '../chat-storage.js'
import {
  isGroupChatMemberMuted,
  type GroupChatSettings,
} from '../shared/group-chat-settings.js'
import { resolveFirstSegmentSpeaker } from './resolve.js'
import { pickFirstSpeakerForSend } from './pick.js'
import { getTurnSegments } from './segments.js'

export function resolveDisplayNameToCharacterId(
  name: string,
  characterIds: string[],
  characterNames: string[],
): string | null {
  const q = name.trim().toLowerCase()
  if (!q) return null
  for (let i = 0; i < characterNames.length; i++) {
    const n = characterNames[i]?.trim()
    const id = characterIds[i]?.trim()
    if (n && id && n.toLowerCase() === q) return id
  }
  return null
}

export function resolveSpeakerQueueIds(
  displayNames: string[],
  characterIds: string[],
  characterNames: string[],
): string[] {
  const out: string[] = []
  for (const name of displayNames) {
    const id = resolveDisplayNameToCharacterId(name, characterIds, characterNames)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/** 组装/落盘：从 `/@` 队列解析本轮 outbound speaker（{{char}}） */
export function resolveOutboundSpeakerCharacterId(params: {
  groupChatEnabled: boolean
  groupChat?: GroupChatSettings
  characterIds: string[]
  characterNames: string[]
  defaultCharacterId: string
  conversationId?: string
  turnOrdinal?: number
  explicitSpeakerCharacterId?: string
  speakerQueueIds?: string[]
  speakerQueueDisplayNames?: string[]
}): string {
  const explicit = params.explicitSpeakerCharacterId?.trim()
  if (explicit) return explicit

  let speakerQueueIds =
    params.speakerQueueIds?.filter((id) => id.trim().length > 0) ?? []
  if (
    speakerQueueIds.length === 0 &&
    params.speakerQueueDisplayNames?.length
  ) {
    speakerQueueIds = resolveSpeakerQueueIds(
      params.speakerQueueDisplayNames,
      params.characterIds,
      params.characterNames,
    )
  }
  if (!params.groupChatEnabled && speakerQueueIds.length > 1) {
    speakerQueueIds = [speakerQueueIds[0]!]
  }
  if (
    params.groupChatEnabled &&
    params.groupChat &&
    params.conversationId &&
    typeof params.turnOrdinal === 'number'
  ) {
    const resolved = resolveFirstSegmentSpeaker({
      groupChat: params.groupChat,
      characterIds: params.characterIds,
      characterNames: params.characterNames,
      conversationId: params.conversationId,
      turnOrdinal: params.turnOrdinal,
      speakerQueueIds,
      defaultCharacterId: params.defaultCharacterId,
    })
    return resolved.speakerCharacterId ?? params.defaultCharacterId
  }
  return pickFirstSpeakerForSend({
    groupChatEnabled: params.groupChatEnabled,
    speakerQueueIds,
    defaultCharacterId: params.defaultCharacterId,
  })
}

export function spokenCharacterIdsFromTurn(
  turn: TurnRecord,
  defaultSpeakerCharacterId: string,
): string[] {
  return getTurnSegments(turn, defaultSpeakerCharacterId)
    .filter((s) => (s.receives?.length ?? 0) > 0)
    .map((s) => s.speakerCharacterId)
    .filter(Boolean)
}

const NEXT_AT_MARKER = /\[NEXT@([^\]]+)\]/g

/** 提取最后一个 [NEXT@Name] 并从正文 strip（宏/插件前） */
export function extractNextSpeakerHint(
  rawAssistant: string,
  characterIds: string[],
  characterNames: string[],
): { content: string; hintCharacterId?: string } {
  let lastName: string | null = null
  let m: RegExpExecArray | null
  const re = new RegExp(NEXT_AT_MARKER.source, 'g')
  while ((m = re.exec(rawAssistant)) !== null) {
    lastName = m[1]?.trim() ?? null
  }
  const content = rawAssistant.replace(NEXT_AT_MARKER, '').trim()
  let hintCharacterId: string | undefined
  if (lastName) {
    const id = resolveDisplayNameToCharacterId(
      lastName,
      characterIds,
      characterNames,
    )
    if (id) hintCharacterId = id
  }
  return { content, hintCharacterId }
}

/** G5：群聊时除当前 speaker 外；非群聊保持「除首绑卡」 */
export function buildGroupChatNotChar(params: {
  groupChatEnabled: boolean
  characterIds: string[]
  characterNames: string[]
  speakerCharacterId: string
}): string {
  const pairs = params.characterIds
    .map((id, i) => ({
      id: id.trim(),
      name: params.characterNames[i]?.trim() ?? '',
    }))
    .filter((p) => p.id && p.name)
  if (pairs.length <= 1) return ''
  if (!params.groupChatEnabled) {
    return pairs
      .slice(1)
      .map((p) => p.name)
      .join(', ')
  }
  const speakerId = params.speakerCharacterId.trim()
  return pairs
    .filter((p) => p.id !== speakerId)
    .map((p) => p.name)
    .join(', ')
}

export function buildGroupMacroStrings(
  characterIds: string[],
  characterNames: string[],
  settings: GroupChatSettings,
): { group: string; groupNotMuted: string } {
  const groupNames: string[] = []
  const notMutedNames: string[] = []
  for (let i = 0; i < characterIds.length; i++) {
    const id = characterIds[i]?.trim()
    if (!id) continue
    const name = characterNames[i]?.trim() || id
    groupNames.push(name)
    if (!isGroupChatMemberMuted(id, settings)) notMutedNames.push(name)
  }
  return {
    group: groupNames.join(', '),
    groupNotMuted: notMutedNames.join(', '),
  }
}
