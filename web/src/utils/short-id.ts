/** 与 server/src/short-id.ts 对齐：8 位十六进制 */
export const SHORT_ID_RE = /^[0-9a-f]{8}$/i

export function generateShortId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(4)
    crypto.getRandomValues(arr)
    return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('')
  }
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0').slice(0, 8)
}

export function allocateShortId(used: Set<string>): string {
  let id: string
  do {
    id = generateShortId()
  } while (used.has(id))
  used.add(id)
  return id
}
