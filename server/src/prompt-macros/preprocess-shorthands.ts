/** ST 变量简写：`{{.name}}` / `{{$name}}` */

export function preprocessVariableShorthands(text: string): string {
  if (!text.includes('{{')) return text
  return text.replace(/\{\{([^}]+)\}\}/g, (match, inner: string) => {
    const raw = inner.trim()
    if (!raw || raw.includes(' ') || raw.includes('::')) return match
    if (raw.startsWith('.') && raw.length > 1 && !raw.startsWith('..')) {
      const name = raw.slice(1).trim()
      if (/^[\w$-]+$/.test(name)) return `{{getvar "${name}"}}`
    }
    if (raw.startsWith('$') && raw.length > 1) {
      const name = raw.slice(1).trim()
      if (/^[\w$-]+$/.test(name)) return `{{getglobalvar "${name}"}}`
    }
    return match
  })
}
