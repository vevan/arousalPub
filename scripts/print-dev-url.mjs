import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDependencies } from './ensure-deps.mjs'

ensureDependencies(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), {
  label: 'dev',
})

const { loadDevConfig } = await import('./dev-config.mjs')

const { webPort } = loadDevConfig()
console.log(`http://localhost:${webPort}/`)
