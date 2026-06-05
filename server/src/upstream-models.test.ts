import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { extractModelIds } from './upstream-models.js'

describe('extractModelIds', () => {
  it('reads OpenAI data[] shape', () => {
    assert.deepEqual(
      extractModelIds({
        data: [{ id: 'gpt-4' }, { id: 'gpt-4o' }],
      }),
      ['gpt-4', 'gpt-4o'],
    )
  })

  it('reads models[] string shape', () => {
    assert.deepEqual(
      extractModelIds({ models: ['a', 'b', 'a'] }),
      ['a', 'b'],
    )
  })
})
