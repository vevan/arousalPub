import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  countChatMessagesTokens,
  estimateTokens,
} from '../src/token-count.js'

describe('contentTokenCache', () => {
  it('matches uncached countChatMessagesTokens', () => {
    const messages = [
      { role: 'system', content: 'fixed preamble '.repeat(80) },
      { role: 'system', content: 'lore block '.repeat(200) },
      { role: 'user', content: 'hello '.repeat(40) },
      { role: 'assistant', content: 'world '.repeat(40) },
    ]
    const plain = countChatMessagesTokens(messages)
    const cache = new Map<string, number>()
    const cached = countChatMessagesTokens(messages, { contentTokenCache: cache })
    assert.equal(cached, plain)
    assert.ok(cache.size >= 4)
  })

  it('reuses encode for unchanged contents across recounts', () => {
    const cache = new Map<string, number>()
    const fixed = 'fixed preamble '.repeat(120)
    const loreA = 'lore-a '.repeat(300)
    const loreB = 'lore-b '.repeat(50)
    const hist = { role: 'user' as const, content: 'hist '.repeat(80) }

    const first = countChatMessagesTokens(
      [
        { role: 'system', content: fixed },
        { role: 'system', content: loreA },
        hist,
      ],
      { contentTokenCache: cache },
    )
    const sizeAfterFirst = cache.size

    const second = countChatMessagesTokens(
      [
        { role: 'system', content: fixed },
        { role: 'system', content: loreB },
        hist,
      ],
      { contentTokenCache: cache },
    )
    assert.equal(cache.size, sizeAfterFirst + 1)
    assert.notEqual(first, second)

    const plainSecond = countChatMessagesTokens([
      { role: 'system', content: fixed },
      { role: 'system', content: loreB },
      hist,
    ])
    assert.equal(second, plainSecond)
  })

  it('estimateTokens respects the same cache', () => {
    const cache = new Map<string, number>()
    const text = 'slot text '.repeat(100)
    const a = estimateTokens(text, { contentTokenCache: cache })
    const b = estimateTokens(text, { contentTokenCache: cache })
    assert.equal(a, b)
    assert.equal(cache.get(text), a)
  })
})
