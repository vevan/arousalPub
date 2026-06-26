import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import { buildReceiveRuntime } from '../src/chat-storage.js'

import { toResolvedFeatureAudit } from '../src/feature-binding-resolve.js'



describe('buildReceiveRuntime', () => {

  it('stores resolvedFeature audit payload', () => {

    const runtime = buildReceiveRuntime({

      model: 'gpt-4o',

      durationMs: 1200,

      estimatedTokens: 4096,

      resolvedFeature: toResolvedFeatureAudit({

        featureType: 'chat',

        featureRefId: 'global',

        apiConfigId: 'preset-a',

        source: 'global',

      }),

    })

    assert.ok(runtime)

    const rf = runtime?.resolvedFeature as {

      featureType?: string

      apiConfigId?: string

      source?: string

    }

    assert.equal(rf.featureType, 'chat')

    assert.equal(rf.apiConfigId, 'preset-a')

    assert.equal(rf.source, 'global')

  })

})


