import { isLanceManifestSchemeError } from './lance-manifest-migrate.js'

/** Lance turn_memory 索引损坏、分片缺失或 manifest V1/V2 混用（需重建或迁移） */
export function isMemoryVectorIndexCorruptError(error: unknown): boolean {
  if (isLanceManifestSchemeError(error)) return true
  const msg = error instanceof Error ? error.message : String(error ?? '')
  if (!msg.trim()) return false
  const lower = msg.toLowerCase()
  if (!lower.includes('not found')) return false
  return (
    lower.includes('turn_memory') ||
    lower.includes('lance error') ||
    lower.includes('.lance')
  )
}
