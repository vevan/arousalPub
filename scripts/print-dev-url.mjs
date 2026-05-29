import { loadDevConfig } from './dev-config.mjs'

const { webPort } = loadDevConfig()
console.log(`http://localhost:${webPort}/`)
