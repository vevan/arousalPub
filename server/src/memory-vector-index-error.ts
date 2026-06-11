/** Lance turn_memory 索引损坏或分片缺失（需重建向量索引） */
export function isMemoryVectorIndexCorruptError(error: unknown): boolean {
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
