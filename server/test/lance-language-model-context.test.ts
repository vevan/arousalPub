import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  getLanceLanguageModelHomeFromContext,
  LANCE_LANGUAGE_MODEL_HOME_ENV,
  withLanceLanguageModelHome,
} from '../src/lance-language-model-context.js'

describe('withLanceLanguageModelHome', () => {
  it('sets env only for the duration of fn when home is provided', async () => {
    const prev = process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]
    delete process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]

    const seen: string[] = []
    await withLanceLanguageModelHome('/tmp/user-a/lance-language-models', async () => {
      seen.push(process.env[LANCE_LANGUAGE_MODEL_HOME_ENV] ?? '')
      assert.equal(
        getLanceLanguageModelHomeFromContext(),
        '/tmp/user-a/lance-language-models',
      )
    })

    assert.deepEqual(seen, ['/tmp/user-a/lance-language-models'])
    assert.equal(process.env[LANCE_LANGUAGE_MODEL_HOME_ENV], prev)

    if (prev !== undefined) {
      process.env[LANCE_LANGUAGE_MODEL_HOME_ENV] = prev
    }
  })

  it('skips env mutation when home is null', async () => {
    const prev = process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]
    process.env[LANCE_LANGUAGE_MODEL_HOME_ENV] = 'unchanged'

    await withLanceLanguageModelHome(null, async () => {
      assert.equal(process.env[LANCE_LANGUAGE_MODEL_HOME_ENV], 'unchanged')
      assert.equal(getLanceLanguageModelHomeFromContext(), undefined)
    })

    assert.equal(process.env[LANCE_LANGUAGE_MODEL_HOME_ENV], 'unchanged')
    if (prev === undefined) {
      delete process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]
    } else {
      process.env[LANCE_LANGUAGE_MODEL_HOME_ENV] = prev
    }
  })

  it('serializes concurrent env writes for different homes', async () => {
    const prev = process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]
    delete process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]

    const order: string[] = []
    await Promise.all([
      withLanceLanguageModelHome('/tmp/a', async () => {
        order.push(`a-start:${process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]}`)
        await new Promise((r) => setTimeout(r, 20))
        order.push(`a-end:${process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]}`)
      }),
      withLanceLanguageModelHome('/tmp/b', async () => {
        order.push(`b-start:${process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]}`)
        await new Promise((r) => setTimeout(r, 5))
        order.push(`b-end:${process.env[LANCE_LANGUAGE_MODEL_HOME_ENV]}`)
      }),
    ])

    assert.ok(order.some((line) => line.startsWith('a-start:/tmp/a')))
    assert.ok(order.some((line) => line.startsWith('b-start:/tmp/b')))
    assert.equal(process.env[LANCE_LANGUAGE_MODEL_HOME_ENV], prev)
    if (prev !== undefined) {
      process.env[LANCE_LANGUAGE_MODEL_HOME_ENV] = prev
    }
  })
})
