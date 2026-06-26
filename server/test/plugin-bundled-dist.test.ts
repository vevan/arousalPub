import assert from 'node:assert/strict'
import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, it } from 'node:test'

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
)
const pluginsDir = path.join(repoRoot, 'plugins')

function maxMtimeInDir(dir: string): number {
  let max = 0
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name)
    if (ent.isDirectory()) {
      max = Math.max(max, maxMtimeInDir(full))
    } else if (ent.isFile() && !ent.name.endsWith('.test.ts')) {
      max = Math.max(max, statSync(full).mtimeMs)
    }
  }
  return max
}

describe('bundled plugin dist sync', () => {
  it('dist is not older than src for plugins with build.mjs', () => {
    const stale: string[] = []
    for (const ent of readdirSync(pluginsDir, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue
      const pluginDir = path.join(pluginsDir, ent.name)
      const buildScript = path.join(pluginDir, 'build.mjs')
      if (!existsSync(buildScript)) continue

      const distWeb = path.join(pluginDir, 'dist/web.mjs')
      const distServer = path.join(pluginDir, 'dist/server.mjs')
      assert.ok(existsSync(distWeb), `${ent.name}: missing dist/web.mjs`)
      assert.ok(existsSync(distServer), `${ent.name}: missing dist/server.mjs`)

      const srcDir = path.join(pluginDir, 'src')
      assert.ok(existsSync(srcDir), `${ent.name}: missing src/`)

      const srcMtime = maxMtimeInDir(srcDir)
      const distMtime = Math.min(statSync(distWeb).mtimeMs, statSync(distServer).mtimeMs)
      if (srcMtime > distMtime) {
        stale.push(ent.name)
      }
    }

    assert.equal(
      stale.length,
      0,
      `Plugin dist stale (run npm run build:plugins): ${stale.join(', ')}`,
    )
  })
})
