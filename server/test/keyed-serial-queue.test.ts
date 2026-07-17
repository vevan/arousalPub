import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  createKeyedCoalesceScheduler,
  createKeyedSerialQueue,
} from '../src/keyed-serial-queue.js'
import { getCurrentUserId, runRequestUserAsync } from '../src/user-context.js'

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

  it('same-key nested run executes inline without deadlock', async () => {
    const q = createKeyedSerialQueue()
    const order: string[] = []
    await q.run('k', async () => {
      order.push('outer-start')
      await q.run('k', async () => {
        order.push('inner')
      })
      order.push('outer-end')
    })
    assert.deepEqual(order, ['outer-start', 'inner', 'outer-end'])
  })

  it('does not treat a finished holder captured via ALS as reentry', async () => {
    const q1 = createKeyedSerialQueue()
    const q2 = createKeyedSerialQueue()
    const order: string[] = []

    // 占住 q2，让 A 中发起的 q2.run 延后到 A 结束之后才执行
    let releaseQ2!: () => void
    const q2Blocker = q2.run('k2', async () => {
      await new Promise<void>((r) => {
        releaseQ2 = r
      })
    })

    let deferred: Promise<void> | undefined
    await q1.run('kx', async () => {
      order.push('A-start')
      // 注册于 A 的 ALS 上下文；将在 A 结束后才真正运行
      deferred = q2.run('k2', async () => {
        order.push('deferred-start')
        // A 已结束，其对 q1:kx 的持有必须失效 → 此处不得 inline，
        // 必须排在 q1 当前占用者之后
        await q1.run('kx', async () => {
          order.push('deferred-inner')
        })
        order.push('deferred-end')
      })
      order.push('A-end')
    })

    // A 结束后让 holder 占住 q1:kx，验证 deferred-inner 会等它
    let releaseHolder!: () => void
    const holder = q1.run('kx', async () => {
      order.push('holder-start')
      await new Promise<void>((r) => {
        releaseHolder = r
      })
      order.push('holder-end')
    })
    await delay(5)
    releaseQ2()
    await delay(20)
    releaseHolder()
    await Promise.all([q2Blocker, deferred!, holder])

    assert.ok(
      order.indexOf('deferred-inner') > order.indexOf('holder-end'),
      `stale ALS hold must not bypass serialization: ${order.join(', ')}`,
    )
  })

  it('different queue instances with the same key string remain independent', async () => {
    const indexQueue = createKeyedSerialQueue()
    const lanceQueue = createKeyedSerialQueue()
    const order: string[] = []

    const searchPromise = lanceQueue.run('u\0kb', async () => {
      order.push('search-start')
      await delay(30)
      order.push('search-end')
    })

    await delay(5)

    const indexPromise = indexQueue.run('u\0kb', async () => {
      order.push('index-start')
      await lanceQueue.run('u\0kb', async () => {
        order.push('lance-write')
      })
      order.push('index-end')
    })

    await Promise.all([searchPromise, indexPromise])

    assert.ok(order.includes('search-start'))
    assert.ok(order.includes('search-end'))
    assert.ok(order.includes('lance-write'))
    assert.ok(
      order.indexOf('lance-write') > order.indexOf('search-end'),
      `lance write must wait for concurrent search: ${order.join(', ')}`,
    )
    assert.ok(
      order.indexOf('index-end') > order.indexOf('lance-write'),
      `index end follows lance write: ${order.join(', ')}`,
    )
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

  it('clearPendingWhere drops coalesced items by key predicate', async () => {
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

    scheduler.schedule({ id: 'a', tag: 'A' })
    await delay(5)
    scheduler.schedule({ id: 'a', tag: 'A2' })
    scheduler.schedule({ id: 'b', tag: 'B' })
    scheduler.clearPendingWhere((key) => key === 'a')
    release()
    await delay(40)

    assert.equal(processed.includes('A2'), false)
    assert.equal(processed.includes('A'), true)
    assert.equal(processed.includes('B'), true)
    assert.equal(processed.length, 2)
  })

  it('isolates same raw key across users and drains in the scheduling user context', async () => {
    const USER_A = 'aaaa0001'
    const USER_B = 'bbbb0002'
    const seen: { tag: string; userId: string }[] = []
    let release!: () => void
    const gate = new Promise<void>((r) => {
      release = r
    })
    let firstEntered = false

    const scheduler = createKeyedCoalesceScheduler<{ id: string; tag: string }>({
      keyOf: (x) => x.id,
      process: async (item) => {
        seen.push({ tag: item.tag, userId: getCurrentUserId() })
        if (!firstEntered) {
          firstEntered = true
          await gate
        }
      },
    })

    await runRequestUserAsync(USER_A, async () => {
      scheduler.schedule({ id: 'kb', tag: 'from-a' })
    })
    await delay(5)
    // A 的首个 drain 仍阻塞在 gate；B 用相同 raw key 调度不应被 A 的 drain 吞掉
    await runRequestUserAsync(USER_B, async () => {
      scheduler.schedule({ id: 'kb', tag: 'from-b' })
    })
    await delay(20)
    release()
    await delay(40)

    assert.deepEqual(
      seen
        .map((s) => `${s.tag}@${s.userId}`)
        .sort(),
      ['from-a@aaaa0001', 'from-b@bbbb0002'],
    )
  })

  it('clearPendingWhere only drops pending items of the current user', async () => {
    const USER_A = 'aaaa0001'
    const USER_B = 'bbbb0002'
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

    await runRequestUserAsync(USER_A, async () => {
      scheduler.schedule({ id: 'conv:1', tag: 'a-first' })
    })
    await delay(5)
    await runRequestUserAsync(USER_A, async () => {
      scheduler.schedule({ id: 'conv:1', tag: 'a-pending' })
    })
    await runRequestUserAsync(USER_B, async () => {
      scheduler.schedule({ id: 'conv:1', tag: 'b-pending' })
    })
    // A 清自己 conv 前缀的 pending，不应影响 B
    await runRequestUserAsync(USER_A, async () => {
      scheduler.clearPendingWhere((key) => key.startsWith('conv:'))
    })
    release()
    await delay(40)

    assert.equal(processed.includes('a-pending'), false)
    assert.equal(processed.includes('a-first'), true)
    assert.equal(processed.includes('b-pending'), true)
  })
})
