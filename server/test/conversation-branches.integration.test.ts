import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const SERVER_TEST_DIR = path.dirname(fileURLToPath(import.meta.url))
const SERVER_SRC = path.join(SERVER_TEST_DIR, '..', 'src')
const REPO_ROOT = path.resolve(SERVER_TEST_DIR, '..', '..')
const INTEGRATION_SCRIPT = path.join(
  SERVER_SRC,
  'integration',
  'conversation-branches-integration.ts',
)

describe('conversation-branches integration (isolated DATA_DIR)', () => {
  it('create → append → tree → switch active path', async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'branch-api-'))
    t.after(async () => {
      await rm(dataDir, { recursive: true, force: true })
    })

    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', INTEGRATION_SCRIPT],
      {
        cwd: REPO_ROOT,
        env: {
          ...process.env,
          DATA_DIR: dataDir,
          AROUSAL_TEST_USER_ID: 'b0000001',
        },
        encoding: 'utf8',
        timeout: 120_000,
      },
    )

    if (result.status !== 0) {
      assert.fail(
        `integration exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      )
    }
    assert.match(result.stdout, /\[branch-integration\] ok/)
    assert.match(result.stdout, /\[branch-recall-integration\] ok/)
    assert.match(result.stdout, /\[branch-nested-integration\] ok/)
    assert.match(result.stdout, /\[branch-cross-integration\] ok/)
    assert.match(result.stdout, /\[branch-accept-main-path\] ok/)
    assert.match(result.stdout, /\[branch-accept-fork-160\] ok/)
  })
})
