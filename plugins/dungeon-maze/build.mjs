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
    entryPoints: [path.join(here, 'src/server.ts')],
    outfile: path.join(here, 'dist/server.mjs'),
  })
  console.log('[dungeon-maze] built dist/web.mjs + dist/server.mjs')
}

build().catch((error) => {
  console.error(error)
  process.exit(1)
})
