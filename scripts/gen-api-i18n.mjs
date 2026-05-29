import { readFileSync, writeFileSync } from 'node:fs'

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

const zh = {}
const en = {}
for (const code of codes) {
  zh[code] = zhByCode[code] ?? enLabel(code)
  en[code] = enLabel(code)
}

const docZh = JSON.parse(readFileSync('web/src/locales/zh.json', 'utf8'))
const account = docZh.settings?.accountApiErrors ?? {}
for (const [code, msg] of Object.entries(account)) {
  if (typeof msg === 'string') zh[code] = msg
}
const docZh2 = JSON.parse(readFileSync('web/src/locales/zh.json', 'utf8'))
docZh2.api = { errors: zh }
writeFileSync('web/src/locales/zh.json', JSON.stringify(docZh2, null, 2) + '\n')

const docEn = JSON.parse(readFileSync('web/src/locales/en.json', 'utf8'))
docEn.api = { errors: en }
writeFileSync('web/src/locales/en.json', JSON.stringify(docEn, null, 2) + '\n')
console.log('i18n keys', Object.keys(zh).length)
