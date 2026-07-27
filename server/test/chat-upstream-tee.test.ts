import assert from 'node:assert/strict'
import { PassThrough, Readable, Transform } from 'node:stream'
import { describe, it } from 'node:test'
import { attachBestEffortClientSseSink } from '../src/chat-upstream-stream.js'

function silentLog() {
  return {
    warn() {},
    error() {},
    info() {},
    debug() {},
    child() {
      return silentLog()
    },
  } as unknown as import('fastify').FastifyBaseLogger
}

describe('attachBestEffortClientSseSink', () => {
  it('keeps consuming upstream after client out is destroyed', async () => {
    const chunks: string[] = []
    const source = Readable.from(['a', 'b', 'c'], { encoding: 'utf8' })
    const tap = new Transform({
      transform(chunk, _enc, cb) {
        chunks.push(String(chunk))
        cb(null, chunk)
      },
    })
    const pipeline = source.pipe(tap)
    const clientOut = new PassThrough()
    clientOut.destroy()
    attachBestEffortClientSseSink(pipeline, clientOut, silentLog())
    await new Promise<void>((resolve, reject) => {
      pipeline.once('end', () => resolve())
      pipeline.once('error', reject)
      // destroy 后仍应结束
      setTimeout(() => reject(new Error('timeout waiting for upstream end')), 2000)
    })
    assert.deepEqual(chunks, ['a', 'b', 'c'])
  })
})
