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

/** 与 DOC/10 §7 对齐的 turn PATCH 所需权限 */
export function requiredPermissionsForTurnPatch(
  before: ConversationTurnDto,
  after: ConversationTurnDto,
): string[] {
  const required = new Set<string>()

  if (before.user !== after.user) {
    required.add('turn.send.write')
  }

  if (after.receives.length < before.receives.length) {
    required.add('turn.receive.prune')
  } else if (after.receives.length > before.receives.length) {
    required.add('turn.receive.content.write')
  }

  const beforeById = new Map(before.receives.map((r) => [r.id, r]))

  for (const recv of after.receives) {
    const prev = beforeById.get(recv.id)
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
    if (receiveMetadataChanged(prev, recv)) {
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
