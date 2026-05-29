/**
 * 一次性迁移：将服务端 error: '中文' 替换为 ApiErrorCodes.* 
 * 运行：node scripts/migrate-api-errors.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs'

/** @type {Record<string, string>} 原文 -> ApiErrorCodes 属性名 */
const LEGACY_TO_PROP = {
  'messages 必须为非空数组': 'messages_required_nonempty',
  'messages 项须为 { role, content }': 'messages_item_role_content',
  '读取会话列表失败': 'chat_list_read_failed',
  '缺少 conversationId': 'missing_conversation_id',
  'conversationId 格式无效': 'invalid_conversation_id',
  'conversationId 无效': 'invalid_conversation_id',
  '会话已存在': 'conversation_already_exists',
  '创建会话失败': 'conversation_create_failed',
  '无效 id': 'invalid_id',
  '须提供 title、promptDebug.maxStored、characterIds、promptPresetId、lorebookIds、lorebookSettings、historySettings、memorySettings、userCharacterId 和/或 userName':
    'patch_conversation_requires_field',
  '会话不存在': 'conversation_not_found',
  'characterIds 须为字符串数组': 'character_ids_must_be_string_array',
  'promptPresetId 须为字符串或 null': 'prompt_preset_id_invalid',
  'lorebookIds 须为字符串数组': 'lorebook_ids_must_be_string_array',
  'lorebookSettings 须为对象或 null': 'lorebook_settings_invalid',
  'lorebookSettings.recursiveEnabled 须为布尔': 'lorebook_settings_recursive_enabled_boolean',
  'lorebookSettings.maxRecursionDepth 须为数字': 'lorebook_settings_max_recursion_depth_number',
  'lorebookSettings.vectorEnabled 须为布尔': 'lorebook_settings_vector_enabled_boolean',
  'lorebookSettings.vectorTopK 须为数字': 'lorebook_settings_vector_top_k_number',
  'lorebookSettings 须含 recursiveEnabled、maxRecursionDepth、vectorEnabled 和/或 vectorTopK':
    'lorebook_settings_requires_field',
  'historySettings 须为对象或 null': 'history_settings_invalid',
  'historySettings.limitEnabled 须为布尔': 'history_settings_limit_enabled_boolean',
  'historySettings.maxTurns 须为数字': 'history_settings_max_turns_number',
  'historySettings 须含 limitEnabled 和/或 maxTurns': 'history_settings_requires_field',
  'memorySettings 须为对象或 null': 'memory_settings_invalid',
  'memorySettings.memoryEnabled 须为布尔': 'memory_settings_memory_enabled_boolean',
  'memorySettings.memoryTopK 须为数字': 'memory_settings_memory_top_k_number',
  'memorySettings 须含 memoryEnabled 和/或 memoryTopK': 'memory_settings_requires_field',
  'userCharacterId 须为字符串或 null': 'user_character_id_invalid',
  'userName 须为字符串或 null': 'user_name_invalid',
  '会话不存在或删除失败': 'conversation_delete_failed',
  '删除会话失败': 'conversation_delete_error',
  'receives 须为非空数组': 'receives_required_nonempty',
  'receives 项格式错误': 'receives_item_invalid',
  'receives.content 须为非空字符串': 'receives_content_required',
  '首条已落盘': 'first_turn_already_saved',
  '开场落盘失败': 'opening_persist_failed',
  '写入开场失败': 'opening_write_failed',
  '缺少 userContent': 'missing_user_content',
  '缺少 assistantContent': 'missing_assistant_content',
  '落盘失败': 'persist_failed',
  '写入对话失败': 'first_turn_write_failed',
  '无效 turnOrdinal': 'invalid_turn_ordinal',
  'userText 须为字符串': 'user_text_must_be_string',
  'receives 项须含 id、content 字符串': 'receives_item_id_content_required',
  'activeReceiveIndex 须为整数': 'active_receive_index_must_be_integer',
  '未找到该轮或尚无落盘 chunk': 'turn_chunk_not_found',
  '更新失败': 'turn_update_failed',
  '无法删除该轮': 'turn_delete_not_found',
  '删除失败': 'turn_delete_failed',
  '提示词数据不可用': 'prompts_unavailable',
  '缺少 userText': 'missing_user_text',
  '会话不存在或尚无尾块': 'conversation_no_tail_chunk',
  '追加轮次失败': 'append_turn_failed',
  '重建远期记忆索引失败': 'memory_rebuild_failed',
  '读取用户偏好失败': 'user_preferences_read_failed',
  '须提供 lorebook、history、memory 和/或 embeddingApi 对象':
    'user_preferences_requires_section',
  'lorebook.recursiveEnabled 须为布尔': 'lorebook_recursive_enabled_boolean',
  'lorebook.maxRecursionDepth 须为数字': 'lorebook_max_recursion_depth_number',
  'lorebook.vectorEnabled 须为布尔': 'lorebook_vector_enabled_boolean',
  'lorebook.vectorTopK 须为数字': 'lorebook_vector_top_k_number',
  'lorebook 须含 recursiveEnabled、maxRecursionDepth、vectorEnabled 和/或 vectorTopK':
    'global_lorebook_requires_field',
  'history.limitEnabled 须为布尔': 'history_limit_enabled_boolean',
  'history.maxTurns 须为数字': 'history_max_turns_number',
  'history 须含 limitEnabled 和/或 maxTurns': 'global_history_requires_field',
  'memory.memoryEnabled 须为布尔': 'memory_enabled_boolean',
  'memory.memoryTopK 须为数字': 'memory_top_k_number',
  'memory 须含 memoryEnabled 和/或 memoryTopK': 'global_memory_requires_field',
  'embeddingApi.baseUrl 须为字符串': 'embedding_api_base_url_string',
  'embeddingApi.apiKey 须为字符串': 'embedding_api_api_key_string',
  'embeddingApi.apiKeyId 须为字符串或 null': 'embedding_api_api_key_id_invalid',
  'embeddingApi.embeddingModel 须为字符串': 'embedding_api_embedding_model_string',
  'embeddingApi.embeddingDimensions 须为数字或 null': 'embedding_api_embedding_dimensions_invalid',
  'embeddingApi 须含 baseUrl、apiKey、apiKeyId、embeddingModel 和/或 embeddingDimensions':
    'global_embedding_api_requires_field',
  '保存用户偏好失败': 'user_preferences_save_failed',
  'Embedding 测试失败': 'embedding_test_failed',
  '读取设置失败': 'settings_read_failed',
  '无效请求体': 'invalid_request_body',
  '缺少 presets 数组': 'missing_presets_array',
  'activePresetId 与 presets 不匹配': 'active_preset_id_mismatch',
  '写入设置失败': 'settings_write_failed',
  '读取提示词失败': 'prompts_read_failed',
  '写入提示词失败': 'prompts_write_failed',
  '预览组装失败': 'prompts_preview_failed',
  '读取世界书失败': 'lorebooks_read_failed',
  '写入世界书失败': 'lorebooks_write_failed',
  '世界书不存在': 'lorebook_not_found',
  '读取角色库失败': 'characters_read_failed',
  '角色不存在': 'character_not_found',
  '角色不存在或无 PNG': 'character_not_found_or_no_png',
  '更新角色失败': 'character_update_failed',
  '须上传 PNG 图像': 'png_image_required',
  '缺少文件字段（multipart 字段名 portrait）': 'missing_portrait_field',
  '缺少文件字段（multipart 字段名 file）': 'missing_file_field',
  'multipart 须包含 payload 字段（JSON 字符串）': 'multipart_payload_required',
  'payload 须为合法 JSON': 'payload_invalid_json',
  '请求体须为 JSON 对象，且包含对象字段 card': 'card_body_invalid',
  '读取 API Keys 失败': 'api_keys_read_failed',
  '写入 API Keys 失败': 'api_keys_write_failed',
  '获取模型列表失败': 'models_list_failed',
  '缺少 apiKey': 'missing_api_key',
  '缺少 model': 'missing_model',
  '上游 API 错误': 'upstream_api_error',
  '上游返回非 JSON': 'upstream_non_json',
  '无法解析提示词预设': 'prompt_preset_unresolved',
  '未登录或登录已过期': 'auth_session_expired',
  '缺少用户名或密码': 'missing_username_or_password',
  '用户名或密码错误': 'invalid_credentials',
  '缺少 refreshToken': 'missing_refresh_token',
  '登录已过期，请重新登录': 'refresh_token_expired',
  '用户不存在或未完成设置': 'user_not_ready',
  '用户无效': 'invalid_user',
  '缺少当前密码或新密码': 'missing_password_fields',
  password_change_failed: 'password_change_failed',
  '请提供 confirmUsername': 'missing_confirm_username',
  delete_account_failed: 'delete_account_failed',
  '缺少文件字段 avatar': 'missing_avatar_field',
  '头像须为 PNG': 'avatar_must_be_png',
  '无头像': 'avatar_not_found',
  '需要登录': 'auth_required',
  persist_error: 'persist_error',
}

const TARGETS = [
  'server/src/index.ts',
  'server/src/auth.ts',
  'server/src/chat-assemble.ts',
]

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function migrateFile(path) {
  let src = readFileSync(path, 'utf8')
  let n = 0
  const sorted = Object.keys(LEGACY_TO_PROP).sort((a, b) => b.length - a.length)
  for (const legacy of sorted) {
    const prop = LEGACY_TO_PROP[legacy]
    const re = new RegExp(`error:\\s*'${escapeRe(legacy)}'`, 'g')
    const next = `error: ApiErrorCodes.${prop}`
    const replaced = src.replace(re, next)
    if (replaced !== src) {
      n += (src.match(re) || []).length
      src = replaced
    }
  }
  // multiline error blocks -> single line code
  const multiline = [
    [
      /error:\s*\n\s*'须提供 title[^']+'/s,
      'error: ApiErrorCodes.patch_conversation_requires_field',
    ],
    [
      /error:\s*\n\s*'lorebookSettings 须含[^']+'/s,
      'error: ApiErrorCodes.lorebook_settings_requires_field',
    ],
    [
      /error:\s*\n\s*'lorebook 须含[^']+'/s,
      'error: ApiErrorCodes.global_lorebook_requires_field',
    ],
    [
      /error:\s*\n\s*'embeddingApi 须含[^']+'/s,
      'error: ApiErrorCodes.global_embedding_api_requires_field',
    ],
  ]
  for (const [re, rep] of multiline) {
    if (re.test(src)) {
      src = src.replace(re, rep)
      n++
    }
  }
  if (!src.includes('ApiErrorCodes')) {
    writeFileSync(path, src)
    console.log(path, 'no ApiErrorCodes used')
    return
  }
  if (!src.includes("from './api-error-codes.js'")) {
    const importLine = "import { ApiErrorCodes } from './api-error-codes.js'\n"
    const idx = src.indexOf('\n')
    src = src.slice(0, idx + 1) + importLine + src.slice(idx + 1)
  }
  writeFileSync(path, src)
  console.log(path, 'replacements', n)
}

for (const f of TARGETS) migrateFile(f)
