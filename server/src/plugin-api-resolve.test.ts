import assert from 'node:assert/strict'

import { describe, it } from 'node:test'

import { resolvePluginCompleteApi } from './plugin-api-resolve.js'



describe('resolvePluginCompleteApi', () => {

  it('rejects empty pluginId', async () => {

    const hit = await resolvePluginCompleteApi({ pluginId: '  ' })

    assert.equal(hit.ok, false)

    if (!hit.ok) {

      assert.equal(hit.code, 'api_config_not_found')

    }

  })

})


