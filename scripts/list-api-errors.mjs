import { readFileSync } from 'node:fs'

const files = [
  'server/src/index.ts',
  'server/src/auth.ts',
  'server/src/chat-assemble.ts',
]
const set = new Set()
for (const f of files) {
  const t = readFileSync(f, 'utf8')
  for (const m of t.matchAll(/error:\s*'([^']+)'/g)) set.add(m[1])
}
console.log([...set].sort().join('\n'))
console.error('count', set.size)
