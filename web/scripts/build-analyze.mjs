import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.ANALYZE = '1'

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const result = spawnSync('vite build', {
  cwd: webRoot,
  stdio: 'inherit',
  shell: true,
})

process.exit(result.status ?? 1)
