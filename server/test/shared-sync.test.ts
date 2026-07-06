import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)

describe('shared sync verify', () => {
  it('server/web copies match shared/ sources', () => {
    const script = path.join(REPO_ROOT, 'scripts', 'verify-shared-sync.mjs')
    const result = spawnSync(process.execPath, [script], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    })
    if (result.status !== 0) {
      assert.fail(
        `verify-shared-sync failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
      )
    }
    assert.match(result.stdout, /\[verify-shared-sync\] ok/)
  })
})
