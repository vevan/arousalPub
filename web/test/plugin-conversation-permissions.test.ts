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
    assert.equal(pluginHasPermission(['conversation.bindings.write'], 'conversation.bindings.write'), true)
    assert.equal(pluginHasPermission(['conversation.read'], 'conversation.bindings.write'), false)
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

  it('mis-comparing active vs other segment looks like content.write (regression guard)', () => {
    const activeSegBefore: ConversationTurnDto = {
      turnOrdinal: 1,
      user: 'u',
      segmentIndex: 0,
      receives: [{ id: 'a1', content: 'active only' }],
      activeReceiveIndex: 0,
    }
    const otherSegPruned: ConversationTurnDto = {
      turnOrdinal: 1,
      user: 'u',
      segmentIndex: 1,
      receives: [{ id: 'b2', content: 'kept swipe' }],
      activeReceiveIndex: 0,
    }
    assert.deepEqual(
      requiredPermissionsForTurnPatch(activeSegBefore, otherSegPruned),
      ['turn.receive.content.write'],
    )
  })

  it('same-segment prune only needs turn.receive.prune', () => {
    const before: ConversationTurnDto = {
      turnOrdinal: 1,
      user: 'u',
      segmentIndex: 1,
      receives: [
        { id: 'b1', content: 'swipe0' },
        { id: 'b2', content: 'swipe1' },
      ],
      activeReceiveIndex: 1,
    }
    const after: ConversationTurnDto = {
      ...before,
      receives: [before.receives[1]!],
      activeReceiveIndex: 0,
    }
    assert.deepEqual(requiredPermissionsForTurnPatch(before, after), [
      'turn.receive.prune',
    ])
    assert.equal(
      canPerformTurnPatch(
        ['conversation.read', 'turn.receive.prune'],
        before,
        after,
      ),
      true,
    )
  })

  it('prune with reallocated client ids still only needs turn.receive.prune', () => {
    const before: ConversationTurnDto = {
      turnOrdinal: 2,
      user: 'u',
      receives: [
        { id: 'alloc-aaa', content: 'kept', model: 'gpt-4o' },
        { id: 'alloc-bbb', content: 'discard' },
      ],
      activeReceiveIndex: 0,
    }
    const after: ConversationTurnDto = {
      turnOrdinal: 2,
      user: 'u',
      receives: [{ id: 'alloc-ZZZ', content: 'kept' }],
      activeReceiveIndex: 0,
    }
    assert.deepEqual(requiredPermissionsForTurnPatch(before, after), [
      'turn.receive.prune',
    ])
  })

  it('prune that also changes kept content still requires content.write', () => {
    const before = baseTurn()
    const after = {
      ...before,
      receives: [{ id: 'r2', content: 'sneak' }],
      activeReceiveIndex: 0,
    }
    assert.deepEqual(requiredPermissionsForTurnPatch(before, after).sort(), [
      'turn.receive.content.write',
      'turn.receive.prune',
    ].sort())
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
        assertTurnPatchPermissions('fixture-plugin-swipe', ['conversation.read'], before, after),
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
      () => assertPluginPermission('fixture-plugin-export', perms, 'turn.receive.prune'),
      PluginPermissionDeniedError,
    )
  })
})
