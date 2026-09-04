import type { ConversationBatchContext } from '@/plugins/conversation-host'
import { turnToConversationDto } from '@/plugins/conversation-host'
import { assertTurnPatchPermissions } from '@/plugins/conversation-turn-patch-permissions'
import { assertPluginPermission } from '@/plugins/plugin-permission-gate'
import type { PluginWebHost } from '@/plugins/types'
import type { ConversationScopeOptions } from '@/plugins/types'
import { usePluginPermissionsStore } from '@/stores/plugin-permissions'
import type { ChatTurnItem } from '@/types/chat-turn'
import { fetchConversationTurnsRange } from '@/utils/chat-messages'
import { getActiveSegmentIndex } from '@/utils/group-chat-turn'

export const PLUGIN_CONVERSATION_READ = 'conversation.read'
export const PLUGIN_CONVERSATION_BINDINGS_WRITE = 'conversation.bindings.write'

function pluginPermissions(pluginId: string): readonly string[] {
  return usePluginPermissionsStore().getPermissions(pluginId)
}

export function assertPluginConversationRead(pluginId: string): void {
  assertPluginPermission(
    pluginId,
    pluginPermissions(pluginId),
    PLUGIN_CONVERSATION_READ,
  )
}

/**
 * 权限比对必须用与 patch 相同的 segment 快照。
 * 只缓存完整 ChatTurnItem（按 ordinal），避免「active segment DTO」误比非 active 的 prune。
 */
async function resolveTurnItemBeforePatch(
  conversationId: string,
  turnOrdinal: number,
  cache: Map<number, ChatTurnItem>,
): Promise<ChatTurnItem> {
  const cached = cache.get(turnOrdinal)
  if (cached) return cached
  const batch = await fetchConversationTurnsRange(
    conversationId,
    turnOrdinal,
    turnOrdinal,
  )
  const turn = batch[0]
  if (!turn) {
    throw new Error(`turn_not_found:${turnOrdinal}`)
  }
  cache.set(turnOrdinal, turn)
  return turn
}

function wrapBatchContext(
  pluginId: string,
  ctx: ConversationBatchContext,
  cache: Map<number, ChatTurnItem>,
): ConversationBatchContext {
  const perms = () => pluginPermissions(pluginId)
  return {
    conversationId: ctx.conversationId,
    read: async (readOpts) => {
      assertPluginPermission(pluginId, perms(), PLUGIN_CONVERSATION_READ)
      return ctx.read(readOpts)
    },
    patchTurns: async (dtos) => {
      for (const after of dtos) {
        const turnItem = await resolveTurnItemBeforePatch(
          ctx.conversationId,
          after.turnOrdinal,
          cache,
        )
        const segIdx =
          typeof after.segmentIndex === 'number' &&
          Number.isFinite(after.segmentIndex)
            ? after.segmentIndex
            : getActiveSegmentIndex(turnItem)
        const before = turnToConversationDto(turnItem, segIdx)
        assertTurnPatchPermissions(pluginId, perms(), before, after)
      }
      return ctx.patchTurns(dtos)
    },
  }
}

export function wrapConversationHostForPlugin(
  conversation: PluginWebHost['conversation'],
  pluginId: string,
): PluginWebHost['conversation'] {
  const id = pluginId.trim()

  async function runScoped(
    opts: ConversationScopeOptions,
    fn: (ctx: ConversationBatchContext) => Promise<void>,
  ): Promise<void> {
    assertPluginConversationRead(id)
    const cache = new Map<number, ChatTurnItem>()
    await conversation.runScope(opts, async (ctx) => {
      await fn(wrapBatchContext(id, ctx, cache))
    })
  }

  return {
    ...conversation,
    getId: conversation.getId,
    async getMeta() {
      assertPluginConversationRead(id)
      return conversation.getMeta()
    },
    runScope: runScoped,
    runBatch(fn) {
      return runScoped({ writeLock: true, requireIdle: true }, fn)
    },
    async refresh() {
      assertPluginConversationRead(id)
      return conversation.refresh()
    },
    setPluginHold(hold: boolean) {
      assertPluginConversationRead(id)
      return conversation.setPluginHold(hold)
    },
  }
}
