import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureDependencies } from './ensure-deps.mjs'

/** Must run before loading config (needs root `yaml`). */
ensureDependencies(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), {
  label: 'start',
})

const { loadDevConfig } = await import('./dev-config.mjs')
const { printTerminalLink } = await import('./terminal-link.mjs')

const { serverPort } = loadDevConfig()
const url = `http://localhost:${serverPort}/`
printTerminalLink(url)
