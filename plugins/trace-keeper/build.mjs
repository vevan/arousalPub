import * as esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  normalizeTextEolPlugin,
  PLUGIN_JSON_LOADER,
} from '../../scripts/plugin-esbuild-shared.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.join(here, '../..')

async function build() {
  const shared = {
    bundle: true,
    format: 'esm',
    target: 'es2022',
    logLevel: 'info',
    loader: PLUGIN_JSON_LOADER,
    plugins: [normalizeTextEolPlugin()],
    absWorkingDir: repoRoot,
  }

  await esbuild.build({
    ...shared,
    platform: 'browser',
    mainFields: ['browser', 'module', 'main'],
    entryPoints: [path.join(here, 'src/index.ts')],
    outfile: path.join(here, 'dist/web.mjs'),
  })

  await esbuild.build({
    ...shared,
    platform: 'node',
    mainFields: ['module', 'main'],
    entryPoints: [path.join(here, 'src/server/index.ts')],
    outfile: path.join(here, 'dist/server.mjs'),
  })

  console.log('[trace-keeper] built dist/web.mjs + dist/server.mjs')

  if (process.env.PLUGIN_WATCH === '1') return

  const { spawnSync } = await import('node:child_process')
  const testFiles = [
    path.join(here, 'src/panel-empty.test.ts'),
    path.join(here, 'src/separate-turn-settings.test.ts'),
    path.join(here, 'src/separate-dialogue.test.ts'),
    path.join(here, 'src/tracker-prompt.test.ts'),
    path.join(here, 'src/trace-state-resolve.test.ts'),
    path.join(here, 'src/server/injection.test.ts'),
  ]
  for (const f of testFiles) {
    const r = spawnSync(process.execPath, ['--import', 'tsx', '--test', f], {
      cwd: repoRoot,
      stdio: 'inherit',
    })
    if (r.status !== 0) process.exit(r.status ?? 1)
  }
}

build().catch((e) => {
  console.error(e)
  process.exit(1)
})
