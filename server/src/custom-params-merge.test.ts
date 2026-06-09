import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { mergeCustomParamsIntoPayload } from './custom-params-merge.js'

describe('mergeCustomParamsIntoPayload', () => {
  it('merges extensions but not protected keys', () => {
    const payload: Record<string, unknown> = {
      model: 'm',
      messages: [{ role: 'user', content: 'hi' }],
    }
    mergeCustomParamsIntoPayload(payload, {
      stop: ['\n'],
      model: 'evil',
      messages: [],
    })
    assert.equal(payload.model, 'm')
    assert.deepEqual(payload.messages, [{ role: 'user', content: 'hi' }])
    assert.deepEqual(payload.stop, ['\n'])
  })
})
