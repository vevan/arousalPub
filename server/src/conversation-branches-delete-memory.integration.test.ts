import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const SERVER_SRC = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SERVER_SRC, '..', '..')
const INTEGRATION_SCRIPT = path.join(
  SERVER_SRC,
  'integration',
  'conversation-branches-delete-memory-integration.ts',
)
describe('conversation branch delete + memory lance integration', () => {
  it('DELETE branch clears disk/registry; Lance rows match plan', async (t) => {
    const dataDir = await mkdtemp(path.join(os.tmpdir(), 'branch-del-'))
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
    assert.match(result.stdout, /\[branch-delete-integration\] ok/)
    assert.match(result.stdout, /\[branch-nested-delete-integration\] ok/)
    assert.match(result.stdout, /\[branch-memory-lance-integration\] ok/)
  })
})
