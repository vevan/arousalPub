import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { ConversationTurnDto } from '../src/plugins/conversation-host.js'
import {
  assertTurnPatchPermissions,
  canPerformTurnPatch,
  requiredPermissionsForTurnPatch,
} from '../src/plugins/conversation-turn-patch-permissions.js'
import {
  PluginPermissionDeniedError,
  assertPluginPermission,
  pluginHasPermission,
} from '../src/plugins/plugin-permission-gate.js'

function baseTurn(): ConversationTurnDto {
  return {
    turnOrdinal: 1,
    user: 'hello',
    receives: [
      { id: 'r1', content: 'a' },
      { id: 'r2', content: 'b' },
    ],
    activeReceiveIndex: 1,
  }
}

describe('pluginHasPermission', () => {
  it('checks manifest permissions list', () => {
    assert.equal(pluginHasPermission(['conversation.read'], 'conversation.read'), true)
    assert.equal(pluginHasPermission(['conversation.read'], 'turn.receive.prune'), false)
  })
})

describe('requiredPermissionsForTurnPatch', () => {
  it('requires turn.receive.prune when receives shrink', () => {
    const before = baseTurn()
    const after = {
      ...before,
      receives: [before.receives[1]!],
      activeReceiveIndex: 0,
    }
    assert.deepEqual(requiredPermissionsForTurnPatch(before, after), [
      'turn.receive.prune',
    ])
  })

  it('requires turn.receive.content.write when assistant content changes', () => {
    const before = baseTurn()
    const after = {
      ...before,
      receives: before.receives.map((r) =>
        r.id === 'r2' ? { ...r, content: 'changed' } : r,
      ),
    }
    assert.deepEqual(requiredPermissionsForTurnPatch(before, after), [
      'turn.receive.content.write',
    ])
  })

  it('requires turn.receive.content.write when receive metadata changes', () => {
    const before = baseTurn()
    const after = {
      ...before,
      receives: before.receives.map((r) =>
        r.id === 'r2' ? { ...r, model: 'gpt-4' } : r,
      ),
    }
    assert.deepEqual(requiredPermissionsForTurnPatch(before, after), [
      'turn.receive.content.write',
    ])
  })

  it('requires turn.send.write when user text changes', () => {
    const before = baseTurn()
    const after = { ...before, user: 'updated' }
    assert.deepEqual(requiredPermissionsForTurnPatch(before, after), [
      'turn.send.write',
    ])
  })
})

describe('assertTurnPatchPermissions', () => {
  it('denies prune without turn.receive.prune', () => {
    const before = baseTurn()
    const after = {
      ...before,
      receives: [before.receives[1]!],
      activeReceiveIndex: 0,
    }
    assert.throws(
      () =>
        assertTurnPatchPermissions('swipe-cleaner', ['conversation.read'], before, after),
      PluginPermissionDeniedError,
    )
    assert.equal(
      canPerformTurnPatch(['conversation.read', 'turn.receive.prune'], before, after),
      true,
    )
  })

  it('allows read-only export plugin to read but not patch', () => {
    const before = baseTurn()
    const perms = ['conversation.read']
    assert.equal(canPerformTurnPatch(perms, before, before), true)
    assert.throws(
      () => assertPluginPermission('conversation-export', perms, 'turn.receive.prune'),
      PluginPermissionDeniedError,
    )
  })
})
