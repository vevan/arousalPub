import * as esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

async function build() {
  const shared = {
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    target: 'es2022',
    logLevel: 'info',
  }

  await esbuild.build({
    ...shared,
    entryPoints: [path.join(here, 'src/index.ts')],
    outfile: path.join(here, 'dist/web.mjs'),
  })

  await esbuild.build({
    ...shared,
    entryPoints: [path.join(here, 'src/server/index.ts')],
    outfile: path.join(here, 'dist/server.mjs'),
  })

  console.log('[curated-memory] built dist/web.mjs + dist/server.mjs')
}

build().catch((e) => {
  console.error(e)
  process.exit(1)
})
