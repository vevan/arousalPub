import * as esbuild from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))

const loaders = {
  '.json': 'json',
  '.hbs': 'text',
  '.css': 'text',
}

async function build() {
  const shared = {
    bundle: true,
    format: 'esm',
    target: 'es2022',
    logLevel: 'info',
    loader: loaders,
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
}

build().catch((e) => {
  console.error(e)
  process.exit(1)
})
