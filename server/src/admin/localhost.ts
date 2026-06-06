/** 请求是否来自本机 loopback（见 DOC/17 §2.1） */
export function isLoopbackAddress(ip: string | undefined): boolean {
  if (!ip) return false
  const n = ip.toLowerCase()
  if (n === '127.0.0.1' || n === '::1') return true
  if (n.startsWith('::ffff:')) {
    const v4 = n.slice('::ffff:'.length)
    if (v4 === '127.0.0.1') return true
  }
  return false
}
