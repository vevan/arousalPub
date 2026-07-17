import { readFileSync, writeFileSync } from 'node:fs'

// --check：只比对不写盘；api.errors 与 api-error-codes.ts 不同步时退出码 1
const checkMode = process.argv.includes('--check')

const migrateSrc = readFileSync('scripts/migrate-api-errors.mjs', 'utf8')
const block = migrateSrc.slice(
  migrateSrc.indexOf('const LEGACY_TO_PROP = '),
  migrateSrc.indexOf('\n\nconst TARGETS'),
)
const zhByCode = {}
for (const m of block.matchAll(/'([^']+)':\s*'([^']+)'/g)) {
  zhByCode[m[2]] = m[1]
}
for (const m of block.matchAll(/(\w+):\s*'([^']+)'/g)) {
  zhByCode[m[2]] = m[1]
}

const extra = {
  missing_conversation_or_user_text: '缺少 conversationId 或 userText',
  assistant_content_empty_no_persist: '助手正文为空，不落盘',
  regenerate_turn_not_found: '未找到再生轮次',
  first_turn_persist_maybe_exists: '首条落盘失败（可能已存在）',
  preset_validation_failed: '预设校验失败',
  prompts_validation_failed: '提示词校验失败',
  lorebooks_validation_failed: '世界书校验失败',
  character_import_failed: '导入失败',
  character_import_png_failed: '导入 PNG 失败',
  character_create_failed: '创建失败',
  portrait_upload_failed: '上传立绘失败',
  api_keys_validation_failed: 'API Keys 校验失败',
  validation_failed: '校验失败',
}
Object.assign(zhByCode, extra)

const codesSrc = readFileSync('server/src/api-error-codes.ts', 'utf8')
const codes = [...codesSrc.matchAll(/^\s+(\w+):/gm)].map((m) => m[1])

function enLabel(code) {
  return code.replace(/_/g, ' ')
}

const docZh = JSON.parse(readFileSync('web/src/locales/zh.json', 'utf8'))
const account = docZh.settings?.accountApiErrors ?? {}
for (const [code, msg] of Object.entries(account)) {
  if (typeof msg === 'string') zhByCode[code] = msg
}

/**
 * 非破坏性生成：已有键值一律保留（手工润色/前端独有错误码不丢），
 * 只为 api-error-codes.ts 中缺失的码补默认文案。check 模式只比对不写盘。
 */
function emit(path, defaultsByCode) {
  const doc = JSON.parse(readFileSync(path, 'utf8'))
  const existing =
    doc.api && typeof doc.api.errors === 'object' ? doc.api.errors : {}
  const errors = { ...existing }
  const missing = []
  for (const code of codes) {
    if (typeof errors[code] === 'string') continue
    errors[code] = defaultsByCode[code] ?? enLabel(code)
    missing.push(code)
  }
  doc.api = { errors }
  const next = JSON.stringify(doc, null, 2) + '\n'
  if (checkMode) {
    if (missing.length > 0) {
      console.error(
        `[gen-api-i18n] ${path} 缺少 ${missing.length} 个错误码文案（如 ${missing
          .slice(0, 5)
          .join(', ')}）；请运行 node scripts/gen-api-i18n.mjs`,
      )
      process.exitCode = 1
    }
    return missing.length
  }
  if (missing.length > 0) writeFileSync(path, next)
  return missing.length
}

const zhAdded = emit('web/src/locales/zh.json', zhByCode)
const enAdded = emit('web/src/locales/en.json', {})
console.log(
  `i18n codes ${codes.length}; zh +${zhAdded}, en +${enAdded}${checkMode ? ' (check)' : ''}`,
)
