import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { after, describe, it } from 'node:test'
import { configureOutboundProxyFromConfig } from '../src/outbound-proxy.js'

const restores: Array<() => void> = []

after(() => {
  while (restores.length) restores.pop()?.()
})

describe('configureOutboundProxyFromConfig', () => {
  it('stays disabled unless enableProxy is explicitly true', () => {
    let calls = 0
    const status = configureOutboundProxyFromConfig(
      {
        enableProxy: false,
        proxyUrl: 'http://127.0.0.1:15888',
        proxyNoProxy: ['localhost'],
      },
      () => {
        calls++
        return () => undefined
      },
    )

    assert.deepEqual(status, {
      enabled: false,
      http: false,
      https: false,
      noProxy: false,
      restore: null,
    })
    assert.equal(calls, 0)
  })

  it('builds an isolated proxy environment and reports redacted flags', () => {
    let received: NodeJS.ProcessEnv | null = null
    const restore = () => undefined
    const status = configureOutboundProxyFromConfig(
      {
        enableProxy: true,
        proxyUrl: ' http://user:secret@proxy.example:8080 ',
        proxyNoProxy: [' localhost ', '', '127.0.0.1'],
      },
      (value) => {
        received = value
        return restore
      },
    )

    assert.deepEqual(received, {
      http_proxy: 'http://user:secret@proxy.example:8080',
      https_proxy: 'http://user:secret@proxy.example:8080',
      no_proxy: 'localhost,127.0.0.1',
    })
    assert.deepEqual(status, {
      enabled: true,
      http: true,
      https: true,
      noProxy: true,
      restore,
    })
    assert.equal(JSON.stringify(status).includes('secret'), false)
  })

  it('rejects a non-boolean enableProxy value', () => {
    assert.throws(
      () => configureOutboundProxyFromConfig({ enableProxy: 'true' } as never),
      /enableProxy must be a boolean/,
    )
  })

  it('requires proxyUrl when proxy is enabled', () => {
    assert.throws(
      () => configureOutboundProxyFromConfig({ enableProxy: true }),
      /proxyUrl is required/,
    )
  })

  it('rejects invalid proxy URLs without echoing credentials', () => {
    const secret = 'top-secret-password'
    assert.throws(
      () =>
        configureOutboundProxyFromConfig({
          enableProxy: true,
          proxyUrl: `not-a-url-${secret}`,
        }),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('proxyUrl') &&
        !error.message.includes(secret),
    )
  })

  it('rejects malformed proxyNoProxy values', () => {
    assert.throws(
      () => configureOutboundProxyFromConfig({
        enableProxy: true,
        proxyUrl: 'http://127.0.0.1:15888',
        proxyNoProxy: ['localhost', 42],
      } as never),
      /proxyNoProxy must contain only strings/,
    )
  })

  it('redacts native configuration failures', () => {
    const secret = 'native-secret'
    assert.throws(
      () =>
        configureOutboundProxyFromConfig(
          {
            enableProxy: true,
            proxyUrl: `http://user:${secret}@127.0.0.1:8080`,
          },
          () => {
            throw new Error(`failed for ${secret}`)
          },
        ),
      (error: unknown) =>
        error instanceof Error &&
        error.message.includes('failed to configure') &&
        !error.message.includes(secret),
    )
  })

  it('routes global fetch through the configured HTTP proxy', async () => {
    const requests: string[] = []
    const proxy = createServer((request, response) => {
      requests.push(request.url ?? '')
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('proxied')
    })
    proxy.on('connect', (request, socket) => {
      requests.push(`CONNECT ${request.url ?? ''}`)
      socket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
      socket.once('data', () => {
        socket.end(
          'HTTP/1.1 200 OK\r\nContent-Type: text/plain\r\nContent-Length: 7\r\nConnection: close\r\n\r\nproxied',
        )
      })
    })
    await new Promise<void>((resolve) => {
      proxy.listen(0, '127.0.0.1', resolve)
    })

    try {
      const address = proxy.address()
      assert(address && typeof address === 'object')
      const status = configureOutboundProxyFromConfig({
        enableProxy: true,
        proxyUrl: `http://127.0.0.1:${address.port}`,
      })
      assert(status.restore)
      restores.push(status.restore)

      const response = await fetch('http://proxy-test.invalid/probe', {
        signal: AbortSignal.timeout(5_000),
      })
      assert.equal(await response.text(), 'proxied')
      assert.equal(requests.length, 1)
      assert.match(
        requests[0]!,
        /^(?:http:\/\/proxy-test\.invalid\/probe|CONNECT proxy-test\.invalid:80)$/,
      )
    } finally {
      restores.pop()?.()
      proxy.closeAllConnections()
      await new Promise<void>((resolve, reject) => {
        proxy.close((error) => (error ? reject(error) : resolve()))
      })
    }
  })

  it('honors proxyNoProxy for matching backend targets', async () => {
    let proxyRequests = 0
    const proxy = createServer((_request, response) => {
      proxyRequests++
      response.writeHead(502)
      response.end('unexpected proxy request')
    })
    proxy.on('connect', (_request, socket) => {
      proxyRequests++
      socket.destroy()
    })
    const target = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('direct')
    })

    await Promise.all([
      new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve)),
      new Promise<void>((resolve) => target.listen(0, '127.0.0.1', resolve)),
    ])

    try {
      const proxyAddress = proxy.address()
      const targetAddress = target.address()
      assert(proxyAddress && typeof proxyAddress === 'object')
      assert(targetAddress && typeof targetAddress === 'object')
      const status = configureOutboundProxyFromConfig({
        enableProxy: true,
        proxyUrl: `http://127.0.0.1:${proxyAddress.port}`,
        proxyNoProxy: ['127.0.0.1'],
      })
      assert(status.restore)
      restores.push(status.restore)

      const response = await fetch(
        `http://127.0.0.1:${targetAddress.port}/probe`,
        { signal: AbortSignal.timeout(5_000) },
      )
      assert.equal(await response.text(), 'direct')
      assert.equal(proxyRequests, 0)
    } finally {
      restores.pop()?.()
      proxy.closeAllConnections()
      target.closeAllConnections()
      await Promise.all([
        new Promise<void>((resolve, reject) => {
          proxy.close((error) => (error ? reject(error) : resolve()))
        }),
        new Promise<void>((resolve, reject) => {
          target.close((error) => (error ? reject(error) : resolve()))
        }),
      ])
    }
  })
})
