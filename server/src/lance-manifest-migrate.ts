import { access, readdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import type { Connection, Table } from '@lancedb/lancedb'
import { closeLanceDb, openLanceDb } from './lance-connection-pool.js'

const MANIFEST_EXTENSION = 'manifest'
const V2_FILENAME_LEN = 20 + 1 + MANIFEST_EXTENSION.length
const U64_MAX = (1n << 64n) - 1n

/** Lance manifest V1/V2 混用（需迁移或重建索引） */
export function isLanceManifestSchemeError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error ?? '')
  if (!msg.trim()) return false
  const lower = msg.toLowerCase()
  return (
    lower.includes('multiple manifest naming schemes') ||
    lower.includes('migrate_manifest_paths_v2')
  )
}

export function detectLanceManifestScheme(
  filename: string,
): 'v1' | 'v2' | null {
  if (!filename.endsWith(`.${MANIFEST_EXTENSION}`)) return null
  if (filename.startsWith('d')) return 'v2'
  if (filename.length === V2_FILENAME_LEN) return 'v2'
  return 'v1'
}

export function lanceV2ManifestFilename(version: number): string {
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`invalid manifest version: ${version}`)
  }
  const inverted = U64_MAX - BigInt(version)
  return `${inverted.toString().padStart(20, '0')}.${MANIFEST_EXTENSION}`
}

function lanceDatasetPath(dbUri: string, tableName: string): string {
  return path.join(path.resolve(dbUri), `${tableName}.lance`)
}

/** 磁盘层 V1→V2 manifest 重命名（openTable 失败时的回退） */
export async function migrateManifestPathsV2OnDisk(
  datasetPath: string,
): Promise<boolean> {
  const versionsDir = path.join(datasetPath, '_versions')
  let entries: string[]
  try {
    entries = await readdir(versionsDir)
  } catch {
    return false
  }

  let changed = false
  for (const name of entries) {
    if (detectLanceManifestScheme(name) !== 'v1') continue
    const versionPart = name.slice(0, name.length - MANIFEST_EXTENSION.length - 1)
    const version = Number(versionPart)
    if (!Number.isInteger(version) || version < 0) continue

    const targetName = lanceV2ManifestFilename(version)
    const sourcePath = path.join(versionsDir, name)
    const targetPath = path.join(versionsDir, targetName)
    if (name === targetName) continue

    try {
      await access(targetPath)
      await unlink(sourcePath)
    } catch {
      await rename(sourcePath, targetPath)
    }
    changed = true
  }
  return changed
}

export async function migrateAllLanceDatasetsInDbUri(
  dbUri: string,
): Promise<number> {
  const root = path.resolve(dbUri)
  let entries: import('node:fs').Dirent[]
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch {
    return 0
  }

  let count = 0
  for (const ent of entries) {
    if (!ent.isDirectory() || !ent.name.endsWith('.lance')) continue
    const migrated = await migrateManifestPathsV2OnDisk(path.join(root, ent.name))
    if (migrated) count += 1
  }
  return count
}

async function ensureV2ManifestPaths(
  db: Connection,
  tableName: string,
): Promise<Table> {
  const table = await db.openTable(tableName)
  try {
    const usesV2 = await table.usesV2ManifestPaths()
    if (usesV2) return table
    await table.migrateManifestPathsV2()
    table.close()
    return db.openTable(tableName)
  } catch (e) {
    table.close()
    throw e
  }
}

async function repairMixedManifestsOnDisk(
  dbUri: string,
  tableName: string,
): Promise<void> {
  const datasetPath = lanceDatasetPath(dbUri, tableName)
  const migrated = await migrateManifestPathsV2OnDisk(datasetPath)
  if (!migrated) {
    await migrateAllLanceDatasetsInDbUri(dbUri)
  }
  closeLanceDb(dbUri)
}

/**
 * 打开 Lance 表：纯 V1 时 API 迁移；V1/V2 混用时先磁盘迁移再重试。
 */
export async function openLanceTableWithManifestMigration(
  db: Connection,
  tableName: string,
  dbUri: string,
): Promise<Table> {
  try {
    return await ensureV2ManifestPaths(db, tableName)
  } catch (e) {
    if (!isLanceManifestSchemeError(e)) throw e
    await repairMixedManifestsOnDisk(dbUri, tableName)
    const freshDb = await openLanceDb(dbUri)
    return ensureV2ManifestPaths(freshDb, tableName)
  }
}

export async function listLanceTableNames(
  db: Connection,
  dbUri: string,
): Promise<string[]> {
  try {
    return await db.tableNames()
  } catch (e) {
    if (!isLanceManifestSchemeError(e)) throw e
    const migrated = await migrateAllLanceDatasetsInDbUri(dbUri)
    if (migrated > 0) {
      // eslint-disable-next-line no-console
      console.warn(
        `[lance] migrated manifest paths v2 for ${migrated} dataset(s) under ${dbUri}`,
      )
    }
    closeLanceDb(dbUri)
    const freshDb = await openLanceDb(dbUri)
    return freshDb.tableNames()
  }
}
