import type { ConversationTurnDto } from './conversation-host'
import {
  assertPluginPermission,
  pluginHasPermission,
} from './plugin-permission-gate'

type ReceiveDto = ConversationTurnDto['receives'][number]

function receiveMetadataChanged(prev: ReceiveDto, next: ReceiveDto): boolean {
  return (
    (prev.durationMs ?? undefined) !== (next.durationMs ?? undefined) ||
    (prev.estimatedTokens ?? undefined) !== (next.estimatedTokens ?? undefined) ||
    (prev.completionTokens ?? undefined) !== (next.completionTokens ?? undefined) ||
    (prev.model ?? undefined) !== (next.model ?? undefined)
  )
}

function receiveTextKey(r: ReceiveDto): string {
  return `${r.content}\0${r.reasoning ?? ''}`
}

/**
 * prune 场景下：session 与权限重拉盘可能对「缺 id」receive 各自 allocateShortId，
 * 或 metadata 字段有无不一致。先按 id，再按 content+reasoning 对齐保留项。
 */
function matchBeforeReceive(
  beforeById: Map<string, ReceiveDto>,
  beforeReceives: ReceiveDto[],
  recv: ReceiveDto,
  usedKeys: Set<string>,
): ReceiveDto | undefined {
  const byId = beforeById.get(recv.id)
  if (byId) {
    usedKeys.add(receiveTextKey(byId))
    return byId
  }
  const key = receiveTextKey(recv)
  if (usedKeys.has(key)) return undefined
  for (const prev of beforeReceives) {
    const prevKey = receiveTextKey(prev)
    if (usedKeys.has(prevKey)) continue
    if (prevKey === key) {
      usedKeys.add(prevKey)
      return prev
    }
  }
  return undefined
}

/** 与 DOC/devNotes/10 §7 对齐的 turn PATCH 所需权限 */
export function requiredPermissionsForTurnPatch(
  before: ConversationTurnDto,
  after: ConversationTurnDto,
): string[] {
  const required = new Set<string>()
  const isPrune = after.receives.length < before.receives.length

  if (before.user !== after.user) {
    required.add('turn.send.write')
  }

  if (isPrune) {
    required.add('turn.receive.prune')
  } else if (after.receives.length > before.receives.length) {
    required.add('turn.receive.content.write')
  }

  const beforeById = new Map(before.receives.map((r) => [r.id, r]))
  const matchedTextKeys = new Set<string>()

  for (const recv of after.receives) {
    const prev = isPrune
      ? matchBeforeReceive(beforeById, before.receives, recv, matchedTextKeys)
      : beforeById.get(recv.id)
    if (!prev) {
      required.add('turn.receive.content.write')
      continue
    }
    if (prev.content !== recv.content) {
      required.add('turn.receive.content.write')
    }
    if ((prev.reasoning ?? '') !== (recv.reasoning ?? '')) {
      required.add('turn.receive.reasoning.write')
    }
    // prune 只裁候选，保留项的 durationMs/model 等与重拉快照不一致不视为改正文
    if (!isPrune && receiveMetadataChanged(prev, recv)) {
      required.add('turn.receive.content.write')
    }
  }

  if (
    before.activeReceiveIndex !== after.activeReceiveIndex &&
    after.receives.length === before.receives.length
  ) {
    required.add('turn.receive.content.write')
  }

  return [...required]
}

export function assertTurnPatchPermissions(
  pluginId: string,
  pluginPermissions: readonly string[],
  before: ConversationTurnDto,
  after: ConversationTurnDto,
): void {
  for (const permission of requiredPermissionsForTurnPatch(before, after)) {
    assertPluginPermission(pluginId, pluginPermissions, permission)
  }
}

export function canPerformTurnPatch(
  pluginPermissions: readonly string[],
  before: ConversationTurnDto,
  after: ConversationTurnDto,
): boolean {
  return requiredPermissionsForTurnPatch(before, after).every((p) =>
    pluginHasPermission(pluginPermissions, p),
  )
}
