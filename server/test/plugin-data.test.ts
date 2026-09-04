import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, it } from 'node:test'

const FIXTURE_PLUGIN = 'fixture-plugin-data'
const TEST_USER = 'b0000001'

/**
 * config.DATA_DIR is fixed at first import of config.js.
 * Set DATA_DIR before importing plugin-data (which pulls paths → config).
 */
describe('pluginData', () => {
  let tmp: string
  let prevDataDir: string | undefined
  let prevTestUser: string | undefined
  let PLUGIN_DATA_MAX_BYTES: typeof import('../src/plugin-system/plugin-data.js').PLUGIN_DATA_MAX_BYTES
  let assertPluginDataContentSize: typeof import('../src/plugin-system/plugin-data.js').assertPluginDataContentSize
  let assertSafePluginDataRelPath: typeof import('../src/plugin-system/plugin-data.js').assertSafePluginDataRelPath
  let createPluginDataApi: typeof import('../src/plugin-system/plugin-data.js').createPluginDataApi
  let resolvePluginDataFilePath: typeof import('../src/plugin-system/plugin-data.js').resolvePluginDataFilePath
  let resolvePluginDataScopeDir: typeof import('../src/plugin-system/plugin-data.js').resolvePluginDataScopeDir

  before(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), 'plugin-data-'))
    prevDataDir = process.env.DATA_DIR
    prevTestUser = process.env.AROUSAL_TEST_USER_ID
    process.env.DATA_DIR = tmp
    process.env.AROUSAL_TEST_USER_ID = TEST_USER
    await mkdir(path.join(tmp, 'plugins', FIXTURE_PLUGIN, TEST_USER), {
      recursive: true,
    })

    ;({
      PLUGIN_DATA_MAX_BYTES,
      assertPluginDataContentSize,
      assertSafePluginDataRelPath,
      createPluginDataApi,
      resolvePluginDataFilePath,
      resolvePluginDataScopeDir,
    } = await import('../src/plugin-system/plugin-data.js'))
  })

  after(async () => {
    if (prevDataDir === undefined) delete process.env.DATA_DIR
    else process.env.DATA_DIR = prevDataDir
    if (prevTestUser === undefined) delete process.env.AROUSAL_TEST_USER_ID
    else process.env.AROUSAL_TEST_USER_ID = prevTestUser
    await rm(tmp, { recursive: true, force: true })
  })

  it('accepts flat filenames and rejects traversal', () => {
    assert.equal(assertSafePluginDataRelPath('notes.json'), 'notes.json')
    assert.equal(assertSafePluginDataRelPath('  a-b_1.txt  '), 'a-b_1.txt')
    for (const bad of [
      '',
      '   ',
      '.',
      '..',
      '../x',
      'a/b',
      'a\\b',
      '/etc/passwd',
      'C:\\Windows\\x',
      'C:foo',
      'foo\0bar',
    ]) {
      assert.throws(
        () => assertSafePluginDataRelPath(bad),
        (e: Error) => e.message === 'invalid_plugin_data_path',
      )
    }
  })

  it('enforces 30 MiB write limit', () => {
    assertPluginDataContentSize('a'.repeat(PLUGIN_DATA_MAX_BYTES))
    assert.throws(
      () => assertPluginDataContentSize('a'.repeat(PLUGIN_DATA_MAX_BYTES + 1)),
      (e: Error & { status?: number }) =>
        e.message === 'plugin_data_too_large' && e.status === 413,
    )
  })

  it('guards conversationId escape', () => {
    assert.throws(
      () =>
        resolvePluginDataScopeDir(
          FIXTURE_PLUGIN,
          TEST_USER,
          'conversation',
          '../global',
        ),
      (e: Error) => e.message === 'invalid_conversation_id',
    )
    assert.throws(
      () =>
        resolvePluginDataScopeDir(FIXTURE_PLUGIN, TEST_USER, 'conversation', ''),
      (e: Error) => e.message === 'missing_conversation_id',
    )
  })

  it('resolves flat file under scope and rejects nested escape', () => {
    const file = resolvePluginDataFilePath(
      FIXTURE_PLUGIN,
      TEST_USER,
      'global',
      'notes.json',
    )
    const scope = resolvePluginDataScopeDir(FIXTURE_PLUGIN, TEST_USER, 'global')
    assert.equal(file, path.join(scope, 'notes.json'))
    assert.ok(file.startsWith(tmp + path.sep) || file.startsWith(tmp))

    assert.throws(
      () =>
        resolvePluginDataFilePath(
          FIXTURE_PLUGIN,
          TEST_USER,
          'global',
          '../secrets.json',
        ),
      (e: Error) => e.message === 'invalid_plugin_data_path',
    )
  })

  it('write/read/list/delete with size limit', async () => {
    const api = createPluginDataApi({
      pluginId: FIXTURE_PLUGIN,
      userId: TEST_USER,
      assertPermission: async () => undefined,
    })

    await api.write('global', 'notes.json', '{"n":0}')
    assert.equal(await api.read('global', 'notes.json'), '{"n":0}')
    assert.deepEqual(await api.list('global'), ['notes.json'])

    await Promise.all([
      api.write('global', 'notes.json', '{"n":1}'),
      api.write('global', 'notes.json', '{"n":2}'),
      api.write('global', 'notes.json', '{"n":3}'),
    ])
    const raw = await api.read('global', 'notes.json')
    assert.ok(raw === '{"n":1}' || raw === '{"n":2}' || raw === '{"n":3}')
    JSON.parse(raw!)

    await assert.rejects(
      () => api.write('global', 'big.json', 'x'.repeat(PLUGIN_DATA_MAX_BYTES + 1)),
      (e: Error & { status?: number }) =>
        e.message === 'plugin_data_too_large' && e.status === 413,
    )

    await api.delete('global', 'notes.json')
    assert.equal(await api.read('global', 'notes.json'), null)
    assert.deepEqual(await api.list('global'), [])
  })

  it('conversation scope isolates under conversations/<id>/', async () => {
    const api = createPluginDataApi({
      pluginId: FIXTURE_PLUGIN,
      userId: TEST_USER,
      assertPermission: async () => undefined,
    })
    const cid = 'convabcd'
    await api.write('conversation', 'memo.txt', 'hi', cid)
    const disk = path.join(
      tmp,
      'plugins',
      FIXTURE_PLUGIN,
      TEST_USER,
      'data',
      'conversations',
      cid,
      'memo.txt',
    )
    assert.equal(await readFile(disk, 'utf8'), 'hi')
    assert.deepEqual(await api.list('conversation', cid), ['memo.txt'])
  })

  it('keeps concurrent RMW when caller serializes', async () => {
    const api = createPluginDataApi({
      pluginId: FIXTURE_PLUGIN,
      userId: TEST_USER,
      assertPermission: async () => undefined,
    })
    const file = 'counter.json'
    await api.write('global', file, JSON.stringify({ items: [] }))

    let chain: Promise<unknown> = Promise.resolve()
    const runExclusive = <T>(task: () => Promise<T>): Promise<T> => {
      const next = chain.then(task, task)
      chain = next.then(
        () => undefined,
        () => undefined,
      )
      return next
    }

    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        runExclusive(async () => {
          const raw = (await api.read('global', file)) ?? '{"items":[]}'
          const doc = JSON.parse(raw) as { items: number[] }
          doc.items.push(i)
          await api.write('global', file, JSON.stringify(doc))
        }),
      ),
    )

    const final = JSON.parse((await api.read('global', file))!) as {
      items: number[]
    }
    assert.equal(final.items.length, 20)
    assert.deepEqual([...final.items].sort((a, b) => a - b), [
      ...Array(20).keys(),
    ])
  })

  it('write is atomic (no leftover tmp; final content intact)', async () => {
    const api = createPluginDataApi({
      pluginId: FIXTURE_PLUGIN,
      userId: TEST_USER,
      assertPermission: async () => undefined,
    })
    await api.write('global', 'atom.json', '{"ok":true}')
    const scope = resolvePluginDataScopeDir(FIXTURE_PLUGIN, TEST_USER, 'global')
    const { readdirSync } = await import('node:fs')
    const names = readdirSync(scope).filter((n) => n === 'atom.json' || n.includes('.tmp'))
    assert.deepEqual(names, ['atom.json'])
    assert.equal(await api.read('global', 'atom.json'), '{"ok":true}')
  })
})
