import { loadDevConfig } from './dev-config.mjs'
import { printTerminalLink } from './terminal-link.mjs'

const { serverPort } = loadDevConfig()
const url = `http://localhost:${serverPort}/`
printTerminalLink(url)
