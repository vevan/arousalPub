import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'
import { getPluginUserSettingsPath, getInstalledPluginDir } from '../src/plugin-system/paths.js'
import {
  __resetPluginWorkersForTest,
  getPluginWorkerClient,
} from '../src/plugin-system/plugin-worker-client.js'
import { createSandboxPluginModule } from '../src/plugin-system/plugin-sandbox-module.js'

const TEST_USER = 'b0000001'
const USER_A = 'aaaa0001'
const USER_B = 'bbbb0002'
let prevTestUser: string | undefined

const ECHO_HOOK_BODY = `export async function resolveAfterAssemblePromptsAddition(ctx, api) {
  const settings = await api.getUserPluginSettings('echo-plugin')
  return [{
    role: 'system',
    content: 'echo:' + (settings?.flag ?? '') + ':' + (ctx?.plugins?.ping ?? ''),
    position: { kind: 'chat', depth: 0, injectionOrder: 10 },
  }]
}
`

describe('plugin worker sandbox (DOC/38 Phase B)', () => {
  let pluginDir = ''
  let entryPath = ''

  before(async () => {
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    process.env.AROUSAL_TEST_USER_ID = TEST_USER
    process.env.PLUGIN_SERVER_SANDBOX = '1'
    pluginDir = await mkdtemp(path.join(tmpdir(), 'plugin-sandbox-'))
    await mkdir(path.join(pluginDir, 'dist'), { recursive: true })
    entryPath = path.join(pluginDir, 'dist', 'server.mjs')
    await writeFile(entryPath, ECHO_HOOK_BODY, 'utf8')
    const echoInstalled = getInstalledPluginDir('echo-plugin')
    await mkdir(echoInstalled, { recursive: true })
    await writeFile(
      path.join(echoInstalled, 'manifest.json'),
      JSON.stringify({
        id: 'echo-plugin',
        name: 'Echo',
        version: '0.0.0',
        settingsSchema: {
          version: 1,
          fields: [{ key: 'flag', type: 'text', labelKey: 'flagLabel' }],
        },
      }),
      'utf8',
    )
    for (const [uid, flag] of [
      [USER_A, 'userA'],
      [USER_B, 'userB'],
    ] as const) {
      const settingsPath = getPluginUserSettingsPath('echo-plugin', uid)
      await mkdir(path.dirname(settingsPath), { recursive: true })
      await writeFile(settingsPath, JSON.stringify({ flag }), 'utf8')
    }
  })

  after(async () => {
    await __resetPluginWorkersForTest()
    delete process.env.PLUGIN_SERVER_SANDBOX
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
  })

  it('loads plugin in worker and proxies Host API', async () => {
    const client = getPluginWorkerClient('echo-plugin', entryPath)
    await client.start()
    assert.ok(client.getExportedHooks().has('resolveAfterAssemblePromptsAddition'))

    const mod = await createSandboxPluginModule('echo-plugin', entryPath)
    assert.equal(typeof mod.resolveAfterAssemblePromptsAddition, 'function')
    assert.equal(mod.runPluginAction, undefined)

    const injections = await mod.resolveAfterAssemblePromptsAddition!(
      {
        pluginId: 'echo-plugin',
        macroContext: {},
        plugins: { ping: 'pong' },
      },
      {} as never,
    )
    assert.ok(Array.isArray(injections))
    assert.equal(injections![0]!.content.includes('echo:'), true)
  })

  it('routes concurrent invokes to distinct userId contexts', async () => {
    const client = getPluginWorkerClient('echo-plugin-concurrent', entryPath)
    await client.start()
    const ctx = {
      pluginId: 'echo-plugin',
      macroContext: {},
      plugins: { ping: 'x' },
    }
    const [a, b] = await Promise.all([
      client.invoke('resolveAfterAssemblePromptsAddition', [ctx], USER_A),
      client.invoke('resolveAfterAssemblePromptsAddition', [ctx], USER_B),
    ])
    const contentA = (a as { content: string }[])[0]!.content
    const contentB = (b as { content: string }[])[0]!.content
    assert.match(contentA, /userA/)
    assert.match(contentB, /userB/)
  })

  it('rejects denied fs import inside sandbox child', async () => {
    const fsDir = await mkdtemp(path.join(tmpdir(), 'plugin-sandbox-fs-'))
    await mkdir(path.join(fsDir, 'dist'), { recursive: true })
    const fsEntry = path.join(fsDir, 'dist', 'server.mjs')
    await writeFile(
      fsEntry,
      `export async function resolveAfterAssemblePromptsAddition() {
  const fs = await import('node:fs')
  fs.readFileSync('C:/Windows/win.ini')
  return null
}
`,
      'utf8',
    )
    const client = getPluginWorkerClient('echo-fs-deny', fsEntry)
    await client.start()
    await assert.rejects(
      () => client.invoke('resolveAfterAssemblePromptsAddition', [{}], TEST_USER),
      (err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        const code =
          err instanceof Error && 'code' in err
            ? String((err as NodeJS.ErrnoException).code)
            : ''
        return (
          /plugin_worker_import_denied|permission|ERR_ACCESS_DENIED|Access denied/i.test(
            msg,
          ) || /ERR_ACCESS_DENIED|EPERM/i.test(code)
        )
      },
    )
    await client.shutdown()
  })

  it('shutdown rejects pending invokes immediately', async () => {
    const slowDir = await mkdtemp(path.join(tmpdir(), 'plugin-sandbox-shutdown-'))
    await mkdir(path.join(slowDir, 'dist'), { recursive: true })
    const slowEntry = path.join(slowDir, 'dist', 'server.mjs')
    await writeFile(
      slowEntry,
      `export async function resolveAfterAssemblePromptsAddition(_ctx, api) {
  await api.getUserPluginSettings('echo-plugin')
  await new Promise((r) => setTimeout(r, 60_000))
  return null
}
`,
      'utf8',
    )
    const client = getPluginWorkerClient('echo-shutdown', slowEntry)
    await client.start()
    const pending = client.invoke(
      'resolveAfterAssemblePromptsAddition',
      [{ pluginId: 'echo-plugin', macroContext: {}, plugins: {} }],
      TEST_USER,
    )
    const caught = pending.then(
      () => assert.fail('expected shutdown rejection'),
      (err: unknown) => err,
    )
    await new Promise((r) => setTimeout(r, 50))
    await client.shutdown()
    const err = await caught
    assert.ok(err instanceof Error)
    assert.match(err.message, /plugin_worker_shutdown/)
  })
})
