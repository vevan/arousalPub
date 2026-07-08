import type { ConversationBatchContext } from '@/plugins/conversation-host'
import { readConversationTurnsRange } from '@/plugins/conversation-host'
import { assertTurnPatchPermissions } from '@/plugins/conversation-turn-patch-permissions'
import { assertPluginPermission } from '@/plugins/plugin-permission-gate'
import type { PluginWebHost } from '@/plugins/types'
import type { ConversationScopeOptions } from '@/plugins/types'
import { usePluginPermissionsStore } from '@/stores/plugin-permissions'

export const PLUGIN_CONVERSATION_READ = 'conversation.read'

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

async function resolveTurnBeforePatch(
  ctx: ConversationBatchContext,
  turnOrdinal: number,
  cache: Map<number, Awaited<ReturnType<ConversationBatchContext['read']>>[number]>,
): Promise<Awaited<ReturnType<ConversationBatchContext['read']>>[number]> {
  const cached = cache.get(turnOrdinal)
  if (cached) return cached
  const batch = await readConversationTurnsRange(ctx.conversationId, {
    from: turnOrdinal,
    to: turnOrdinal,
  })
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
  cache: Map<number, Awaited<ReturnType<ConversationBatchContext['read']>>[number]>,
): ConversationBatchContext {
  const perms = () => pluginPermissions(pluginId)
  return {
    conversationId: ctx.conversationId,
    read: async (readOpts) => {
      assertPluginPermission(pluginId, perms(), PLUGIN_CONVERSATION_READ)
      const turns = await ctx.read(readOpts)
      for (const turn of turns) {
        cache.set(turn.turnOrdinal, turn)
      }
      return turns
    },
    patchTurns: async (dtos) => {
      for (const after of dtos) {
        const before = await resolveTurnBeforePatch(ctx, after.turnOrdinal, cache)
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
    const cache = new Map<
      number,
      Awaited<ReturnType<ConversationBatchContext['read']>>[number]
    >()
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
