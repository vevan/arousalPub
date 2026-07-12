import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createKeyedCoalesceScheduler,
  createKeyedSerialQueue,
} from '../src/keyed-serial-queue.js'

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('createKeyedSerialQueue', () => {
  it('runs same-key tasks strictly in order', async () => {
    const q = createKeyedSerialQueue()
    const order: number[] = []
    const a = q.run('lb-1', async () => {
      await delay(30)
      order.push(1)
    })
    const b = q.run('lb-1', async () => {
      order.push(2)
    })
    await Promise.all([a, b])
    assert.deepEqual(order, [1, 2])
  })

  it('allows different keys to overlap', async () => {
    const q = createKeyedSerialQueue()
    let concurrent = 0
    let maxConcurrent = 0
    const bump = async () => {
      concurrent += 1
      maxConcurrent = Math.max(maxConcurrent, concurrent)
      await delay(20)
      concurrent -= 1
    }
    await Promise.all([q.run('a', bump), q.run('b', bump)])
    assert.equal(maxConcurrent, 2)
  })
})

describe('createKeyedCoalesceScheduler', () => {
  it('coalesces scheduled items to the latest while a run is in flight', async () => {
    const processed: string[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let firstEntered = false

    const scheduler = createKeyedCoalesceScheduler<{ id: string; tag: string }>({
      keyOf: (x) => x.id,
      process: async (item) => {
        processed.push(item.tag)
        if (!firstEntered) {
          firstEntered = true
          await gate
        }
      },
    })

    scheduler.schedule({ id: 'lb', tag: 'A' })
    await delay(5)
    scheduler.schedule({ id: 'lb', tag: 'B' })
    scheduler.schedule({ id: 'lb', tag: 'C' })
    release()
    await delay(40)

    assert.deepEqual(processed, ['A', 'C'])
  })

  it('runExclusive serializes with schedule on the same key', async () => {
    const order: string[] = []
    const scheduler = createKeyedCoalesceScheduler<{ id: string; tag: string }>({
      keyOf: (x) => x.id,
      process: async (item) => {
        order.push(`sched:${item.tag}`)
        await delay(20)
      },
    })

    scheduler.schedule({ id: 'lb', tag: '1' })
    const exclusive = scheduler.runExclusive('lb', async () => {
      order.push('exclusive')
    })
    await exclusive
    await delay(10)
    assert.deepEqual(order, ['sched:1', 'exclusive'])
  })
})
