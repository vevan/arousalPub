import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dir = path.dirname(fileURLToPath(import.meta.url))
const migrateSrc = readFileSync(path.join(dir, 'migrate-api-errors.mjs'), 'utf8')
const start = migrateSrc.indexOf('const LEGACY_TO_PROP = ')
const end = migrateSrc.indexOf('\n\nconst TARGETS')
const obj = eval(
  '(' + migrateSrc.slice(start + 'const LEGACY_TO_PROP = '.length, end).trim() + ')',
)
const props = [...new Set(Object.values(obj))].sort()
const lines = props.map((p) => `  ${p}: '${p}',`).join('\n')
const out = `/** API 可本地化错误码（前端 api.errors.*） */
export const ApiErrorCodes = {
${lines}
} as const

export type ApiErrorCode = (typeof ApiErrorCodes)[keyof typeof ApiErrorCodes]

export {
  UserAccountErrorCodes,
  type UserAccountErrorCode,
} from './user-account-error.js'
`
writeFileSync(path.join(dir, '../server/src/api-error-codes.ts'), out)
console.log('wrote', props.length, 'codes')
