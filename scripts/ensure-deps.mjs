import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSyncNpm } from './spawn-npm.mjs'

const STAMP_REL = path.join('node_modules', '.deps-stamp.json')

/** Files whose changes should trigger npm install */
const DEP_MANIFESTS = [
  'package-lock.json',
  'package.json',
  'server/package.json',
  'web/package.json',
]

function stampPath(repoRoot) {
  return path.join(repoRoot, STAMP_REL)
}

function computeDepsFingerprint(repoRoot) {
  const hash = createHash('sha256')
  for (const rel of DEP_MANIFESTS) {
    const abs = path.join(repoRoot, rel)
    hash.update(rel)
    hash.update('\0')
    if (!existsSync(abs)) {
      hash.update('missing')
      continue
    }
    hash.update(readFileSync(abs))
  }
  return hash.digest('hex')
}

function readStamp(repoRoot) {
  const abs = stampPath(repoRoot)
  if (!existsSync(abs)) return null
  try {
    const parsed = JSON.parse(readFileSync(abs, 'utf8'))
    return typeof parsed?.hash === 'string' ? parsed.hash : null
  } catch {
    return null
  }
}

function writeStamp(repoRoot, hash) {
  const abs = stampPath(repoRoot)
  mkdirSync(path.dirname(abs), { recursive: true })
  writeFileSync(abs, `${JSON.stringify({ hash, manifests: DEP_MANIFESTS }, null, 2)}\n`)
}

function runNpmInstall(repoRoot) {
  const r = spawnSyncNpm(['install'], {
    cwd: repoRoot,
    stdio: 'inherit',
  })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

/**
 * Install dependencies when node_modules is missing or lock/manifests changed.
 * @param {string} repoRoot
 * @param {{ label?: string }} [options]
 */
export function ensureDependencies(repoRoot, { label = 'start' } = {}) {
  const nodeModules = path.join(repoRoot, 'node_modules')
  const fingerprint = computeDepsFingerprint(repoRoot)
  const stamped = readStamp(repoRoot)

  if (existsSync(nodeModules) && stamped === fingerprint) return

  if (!existsSync(nodeModules)) {
    console.log(`[${label}] node_modules not found, running npm install …\n`)
  } else if (stamped == null) {
    console.log(
      `[${label}] Dependency stamp missing, running npm install …\n`,
    )
  } else {
    console.log(
      `[${label}] Dependencies out of date (lock or package.json changed), running npm install …\n`,
    )
  }

  runNpmInstall(repoRoot)
  writeStamp(repoRoot, computeDepsFingerprint(repoRoot))
}
