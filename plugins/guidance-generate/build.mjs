import * as esbuild from 'esbuild'
import { utimesSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

async function build() {
  await esbuild.build({
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'es2022',
    logLevel: 'info',
    entryPoints: [path.join(here, 'src/server/index.ts')],
    outfile: path.join(here, 'dist/server.mjs'),
  })
  const now = new Date()
  utimesSync(path.join(here, 'dist/web.mjs'), now, now)
  console.log('[guidance-generate] built dist/server.mjs')
}

build().catch((e) => {
  console.error(e)
  process.exit(1)
})
