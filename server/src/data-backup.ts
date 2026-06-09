import { ZipArchive } from 'archiver'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
} from 'node:fs'
import { readdir, rename, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Dirent } from 'node:fs'
import { resolveBackupSettings, type BackupSettings } from './backup-config.js'
import { DATA_DIR } from './config.js'
import {
  acquireMaintenanceLock,
  releaseMaintenanceLock,
} from './maintenance-lock.js'

const BACKUPS_DIR_NAME = 'backups'
const MANIFEST_NAME = 'backup-manifest.json'

export interface BackupManifest {
  lastSuccessAt?: string
  file?: string
  bytes?: number
  lastFailedAt?: string
  lastError?: string
}

export interface BackupStatus {
  running: boolean
  filesDone: number
  filesTotal: number
  lastSuccessAt: string | null
  lastError: string | null
}

let backupRunning = false
let filesDone = 0
let filesTotal = 0

function getBackupsDir(): string {
  return path.join(DATA_DIR, BACKUPS_DIR_NAME)
}

function getManifestPath(): string {
  return path.join(getBackupsDir(), MANIFEST_NAME)
}

function shouldSkipRelative(rel: string): boolean {
  const norm = rel.replace(/\\/g, '/')
  return norm === BACKUPS_DIR_NAME || norm.startsWith(`${BACKUPS_DIR_NAME}/`)
}

function readManifest(): BackupManifest {
  const manifestPath = getManifestPath()
  if (!existsSync(manifestPath)) return {}
  try {
    const raw = readFileSync(manifestPath, 'utf8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return {}
    return parsed as BackupManifest
  } catch {
    return {}
  }
}

async function writeManifest(manifest: BackupManifest): Promise<void> {
  mkdirSync(getBackupsDir(), { recursive: true })
  await writeFile(
    getManifestPath(),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8',
  )
}

async function walkDataFiles(
  onEntry: (absPath: string, relPath: string) => void | Promise<void>,
): Promise<void> {
  async function walk(dir: string, relBase: string): Promise<void> {
    let entries: Dirent[]
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const ent of entries) {
      const rel = relBase ? `${relBase}/${ent.name}` : ent.name
      if (shouldSkipRelative(rel)) continue
      const abs = path.join(dir, ent.name)
      if (ent.isDirectory()) {
        await walk(abs, rel)
      } else if (ent.isFile()) {
        await onEntry(abs, rel)
      }
    }
  }
  await walk(DATA_DIR, '')
}

async function countFilesToBackup(): Promise<number> {
  let count = 0
  await walkDataFiles(() => {
    count += 1
  })
  return count
}

function formatBackupTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
}

export function evaluateBackupSchedule(
  settings: BackupSettings,
  manifest: BackupManifest,
  now: number,
  isRunning: boolean,
): boolean {
  if (!settings.enabled) return false
  if (isRunning) return false
  if (manifest.lastFailedAt) {
    const failedAt = Date.parse(manifest.lastFailedAt)
    if (
      !Number.isNaN(failedAt) &&
      (now - failedAt) / 3_600_000 < settings.retryHours
    ) {
      return false
    }
  }
  if (!manifest.lastSuccessAt) return true
  const lastSuccess = Date.parse(manifest.lastSuccessAt)
  if (Number.isNaN(lastSuccess)) return true
  const daysSince = Math.floor((now - lastSuccess) / 86_400_000)
  return daysSince >= settings.intervalDays
}

export function shouldRunBackupOnStartup(now = Date.now()): boolean {
  return evaluateBackupSchedule(
    resolveBackupSettings(),
    readManifest(),
    now,
    backupRunning,
  )
}

export function getBackupStatus(): BackupStatus {
  const manifest = readManifest()
  return {
    running: backupRunning,
    filesDone,
    filesTotal,
    lastSuccessAt: manifest.lastSuccessAt ?? null,
    lastError: backupRunning ? null : (manifest.lastError ?? null),
  }
}

async function createDataZip(outputPath: string): Promise<void> {
  const output = createWriteStream(outputPath)
  const archive = new ZipArchive({ zlib: { level: 6 } })

  await new Promise<void>((resolve, reject) => {
    output.on('close', () => resolve())
    output.on('error', reject)
    archive.on('error', reject)
    archive.pipe(output)

    void walkDataFiles((absPath, relPath) => {
      archive.file(absPath, { name: relPath.replace(/\\/g, '/') })
      filesDone += 1
    })
      .then(() => archive.finalize())
      .catch(reject)
  })
}

async function pruneOldBackups(maxKept: number): Promise<void> {
  const dir = getBackupsDir()
  let names: string[]
  try {
    names = await readdir(dir)
  } catch {
    return
  }
  const zips = names
    .filter((name) => name.startsWith('backup-') && name.endsWith('.zip'))
    .map((name) => {
      const full = path.join(dir, name)
      return { name, mtime: statSync(full).mtimeMs }
    })
    .sort((a, b) => a.mtime - b.mtime)

  while (zips.length > maxKept) {
    const oldest = zips.shift()
    if (!oldest) break
    await unlink(path.join(dir, oldest.name)).catch(() => {})
  }
}

export async function runDataBackup(): Promise<{ ok: boolean; error?: string }> {
  if (backupRunning) return { ok: false, error: 'already_running' }

  const settings = resolveBackupSettings()
  if (!settings.enabled) return { ok: false, error: 'disabled' }

  backupRunning = true
  filesDone = 0
  filesTotal = 0
  acquireMaintenanceLock('data_backup')

  const backupsDir = getBackupsDir()
  mkdirSync(backupsDir, { recursive: true })

  const zipName = `backup-${formatBackupTimestamp(new Date())}.zip`
  const tmpPath = path.join(backupsDir, `${zipName}.tmp`)
  const finalPath = path.join(backupsDir, zipName)

  try {
    filesTotal = await countFilesToBackup()
    await createDataZip(tmpPath)
    await rename(tmpPath, finalPath)
    const bytes = statSync(finalPath).size

    await writeManifest({
      lastSuccessAt: new Date().toISOString(),
      file: zipName,
      bytes,
    })
    await pruneOldBackups(settings.maxKept)
    return { ok: true }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    const prev = readManifest()
    await writeManifest({
      ...prev,
      lastFailedAt: new Date().toISOString(),
      lastError: msg,
    })
    if (existsSync(tmpPath)) {
      await unlink(tmpPath).catch(() => {})
    }
    return { ok: false, error: msg }
  } finally {
    backupRunning = false
    releaseMaintenanceLock()
  }
}

export function scheduleStartupBackupIfNeeded(): void {
  if (!shouldRunBackupOnStartup()) return
  void runDataBackup().then((result) => {
    if (result.ok) {
      // eslint-disable-next-line no-console
      console.log('[backup] startup backup completed')
      return
    }
    if (result.error === 'already_running' || result.error === 'disabled') return
    // eslint-disable-next-line no-console
    console.warn('[backup] startup backup failed:', result.error)
  })
}
