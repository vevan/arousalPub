import * as esbuild from 'esbuild'
import { writeFileSync } from 'node:fs'
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
    entryPoints: [path.join(here, 'src/web/index.ts')],
    outfile: path.join(here, 'dist/web.mjs'),
    external: [],
  })

  writeFileSync(
    path.join(here, 'dist/server.mjs'),
    '/** swipe-cleaner: no server hooks */\n',
    'utf8',
  )

  console.log('[swipe-cleaner] built dist/web.mjs + dist/server.mjs')
}

build().catch((e) => {
  console.error(e)
  process.exit(1)
})
