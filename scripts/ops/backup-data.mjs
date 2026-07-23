#!/usr/bin/env node
/**
 * Ops helper: zip the data root (excluding backups/), without starting the server.
 * Invoked by backup.example.bat / backup.example.sh — see DOC/03 §8.7.
 *
 * Usage:
 *   node scripts/ops/backup-data.mjs [output-dir]
 *
 * Data root resolution (first hit):
 *   DATA_DIR | AROUSAL_DATA_DIR | config.yaml dataDir | ./data
 *
 * Does not create or mutate config.yaml (read-only).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { parse as parseYaml } from 'yaml'
import { findRepoRoot, getConfigPaths } from '../load-config.mjs'

/** @param {string} root */
function resolveDataDir(root) {
  const fromEnv = process.env.DATA_DIR || process.env.AROUSAL_DATA_DIR
  if (fromEnv && String(fromEnv).trim()) {
    return path.resolve(String(fromEnv).trim())
  }
  const { config } = getConfigPaths(root)
  let raw = './data'
  if (existsSync(config)) {
    try {
      const parsed = parseYaml(readFileSync(config, 'utf8'))
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const d = /** @type {Record<string, unknown>} */ (parsed).dataDir
        if (typeof d === 'string' && d.trim()) raw = d.trim()
      }
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[backup] failed to parse config.yaml, using ./data:', e)
    }
  }
  return path.isAbsolute(raw) ? path.normalize(raw) : path.resolve(root, raw)
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').replace(/Z$/, 'Z')
}

/** True if `inner` is the same as or nested under `outer`. */
function isInsideOrSame(inner, outer) {
  const a = path.resolve(inner)
  const b = path.resolve(outer)
  const rel = path.relative(b, a)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function countFiles(dir, excludeName) {
  let n = 0
  if (!existsSync(dir)) return 0
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === excludeName && path.resolve(d) === path.resolve(dir)) continue
      const p = path.join(d, name)
      const st = statSync(p)
      if (st.isDirectory()) walk(p)
      else n += 1
    }
  }
  walk(dir)
  return n
}

function main() {
  const root = findRepoRoot()
  const dataDir = resolveDataDir(root)
  const outArg = process.argv[2]
  const outDir = outArg
    ? path.resolve(outArg)
    : path.join(root, 'backup-out')

  // eslint-disable-next-line no-console
  console.log('')
  // eslint-disable-next-line no-console
  console.log('=== Arousal Pub ops backup (example) ===')
  // eslint-disable-next-line no-console
  console.log('Stop the app before running this script (avoid half-written files).')
  // eslint-disable-next-line no-console
  console.log('This does NOT replace product cold backup (DOC/03 §8.8 → data/backups/).')
  // eslint-disable-next-line no-console
  console.log('Syncthing should ignore backups/; this archive also excludes that folder.')
  // eslint-disable-next-line no-console
  console.log('')

  if (!existsSync(dataDir) || !statSync(dataDir).isDirectory()) {
    // eslint-disable-next-line no-console
    console.error(`[backup] data dir missing or not a directory: ${dataDir}`)
    process.exit(1)
  }

  if (isInsideOrSame(outDir, dataDir)) {
    // eslint-disable-next-line no-console
    console.error(`[backup] output dir must not be inside dataDir (would nest/self-include):`)
    // eslint-disable-next-line no-console
    console.error(`  dataDir: ${dataDir}`)
    // eslint-disable-next-line no-console
    console.error(`  outDir:  ${outDir}`)
    process.exit(1)
  }

  mkdirSync(outDir, { recursive: true })
  const outFile = path.join(outDir, `backup-${stamp()}.zip`)
  const approxFiles = countFiles(dataDir, 'backups')
  // eslint-disable-next-line no-console
  console.log(`[backup] dataDir: ${dataDir}`)
  // eslint-disable-next-line no-console
  console.log(`[backup] output:  ${outFile}`)
  // eslint-disable-next-line no-console
  console.log(`[backup] approx files (excl. backups/): ${approxFiles}`)

  // Windows 10+ and Unix: tar can write zip with -a
  const args = ['-a', '-cf', outFile, '--exclude', 'backups', '-C', dataDir, '.']
  // eslint-disable-next-line no-console
  console.log(`[backup] running: tar ${args.map((a) => JSON.stringify(a)).join(' ')}`)

  const r = spawnSync('tar', args, {
    encoding: 'utf8',
    shell: false,
    maxBuffer: 16 * 1024 * 1024,
  })

  if (r.error || r.status !== 0) {
    // eslint-disable-next-line no-console
    console.error('[backup] tar failed')
    // eslint-disable-next-line no-console
    console.error(`[backup] cwd (implied via -C): ${dataDir}`)
    // eslint-disable-next-line no-console
    console.error(`[backup] argv: tar ${args.map((a) => JSON.stringify(a)).join(' ')}`)
    if (r.error) {
      const err = /** @type {NodeJS.ErrnoException} */ (r.error)
      // eslint-disable-next-line no-console
      console.error(`[backup] spawn error name: ${err.name}`)
      // eslint-disable-next-line no-console
      console.error(`[backup] spawn error message: ${err.message}`)
      if (err.code) {
        // eslint-disable-next-line no-console
        console.error(`[backup] spawn error code: ${err.code}`)
      }
      if (err.stack) {
        // eslint-disable-next-line no-console
        console.error('[backup] spawn stack:')
        // eslint-disable-next-line no-console
        console.error(err.stack)
      }
      // eslint-disable-next-line no-console
      console.error(
        '[backup] Hint: install tar (Windows 10+ ships tar.exe) or ensure it is on PATH.',
      )
    }
    if (r.status != null) {
      // eslint-disable-next-line no-console
      console.error(`[backup] exit status: ${r.status}`)
    }
    if (r.signal) {
      // eslint-disable-next-line no-console
      console.error(`[backup] signal: ${r.signal}`)
    }
    const stdout = typeof r.stdout === 'string' ? r.stdout : ''
    const stderr = typeof r.stderr === 'string' ? r.stderr : ''
    if (stdout.trim()) {
      // eslint-disable-next-line no-console
      console.error('[backup] stdout:')
      // eslint-disable-next-line no-console
      console.error(stdout.trimEnd())
    }
    if (stderr.trim()) {
      // eslint-disable-next-line no-console
      console.error('[backup] stderr:')
      // eslint-disable-next-line no-console
      console.error(stderr.trimEnd())
    }
    if (!r.error && !stdout.trim() && !stderr.trim()) {
      // eslint-disable-next-line no-console
      console.error('[backup] No stdout/stderr captured from tar.')
    }
    process.exit(r.status ?? 1)
  }

  if (typeof r.stdout === 'string' && r.stdout.trim()) {
    // eslint-disable-next-line no-console
    console.log(r.stdout.trimEnd())
  }
  if (typeof r.stderr === 'string' && r.stderr.trim()) {
    // eslint-disable-next-line no-console
    console.warn(r.stderr.trimEnd())
  }

  // eslint-disable-next-line no-console
  console.log(`[backup] done: ${outFile}`)
}

try {
  main()
} catch (e) {
  // eslint-disable-next-line no-console
  console.error('[backup] unexpected error')
  if (e instanceof Error) {
    // eslint-disable-next-line no-console
    console.error(`[backup] ${e.name}: ${e.message}`)
    if (e.stack) {
      // eslint-disable-next-line no-console
      console.error(e.stack)
    }
  } else {
    // eslint-disable-next-line no-console
    console.error('[backup]', e)
  }
  process.exit(1)
}