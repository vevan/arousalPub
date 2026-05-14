import { inflateSync } from 'node:zlib'
import CRC32 from 'crc-32'

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

export function isPngBuffer(buf: Buffer): boolean {
  return buf.length >= 8 && buf.subarray(0, 8).equals(PNG_SIG)
}

interface PngChunk {
  type: string
  data: Buffer
}

function readUInt32BE(buf: Buffer, offset: number): number {
  return buf.readUInt32BE(offset)
}

/** 遍历 PNG chunk（不校验 CRC，与多数 ST 导出兼容） */
export function readPngChunks(buf: Buffer): PngChunk[] {
  if (!isPngBuffer(buf)) {
    throw new Error('不是有效的 PNG 文件')
  }
  const chunks: PngChunk[] = []
  let o = 8
  while (o + 12 <= buf.length) {
    const len = readUInt32BE(buf, o)
    const type = buf.toString('ascii', o + 4, o + 8)
    if (o + 12 + len > buf.length) {
      throw new Error('PNG chunk 长度异常')
    }
    const data = buf.subarray(o + 8, o + 8 + len)
    chunks.push({ type, data })
    o += 12 + len
  }
  return chunks
}

function pngChunkBytes(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, 'ascii')
  const lenBuf = Buffer.alloc(4)
  lenBuf.writeUInt32BE(data.length, 0)
  const crcTarget = Buffer.concat([typeBuf, data])
  const crc = CRC32.buf(crcTarget) >>> 0
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc, 0)
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf])
}

export function buildPngFromChunks(chunks: PngChunk[]): Buffer {
  const parts: Buffer[] = [PNG_SIG]
  for (const c of chunks) {
    parts.push(pngChunkBytes(c.type, c.data))
  }
  return Buffer.concat(parts)
}

function parseTexKeyword(data: Buffer): { keyword: string; rest: Buffer } | null {
  const z = data.indexOf(0)
  if (z <= 0) return null
  const keyword = data.subarray(0, z).toString('latin1')
  const rest = data.subarray(z + 1)
  return { keyword, rest }
}

function parseZtxtKeyword(data: Buffer): { keyword: string; compressed: Buffer } | null {
  const z = data.indexOf(0)
  if (z <= 0) return null
  const keyword = data.subarray(0, z).toString('latin1')
  const compMethod = data[z + 1]
  if (compMethod !== 0) return null
  const compressed = data.subarray(z + 2)
  return { keyword, compressed }
}

/** TavernCardV2 `data` 规范字段（与 SillyTavern spec 对齐） */
const TAVERN_V2_STRING_FIELDS = [
  'name',
  'description',
  'personality',
  'scenario',
  'first_mes',
  'mes_example',
  'creator_notes',
  'system_prompt',
  'post_history_instructions',
  'creator',
  'character_version',
] as const

const TAVERN_V2_RESERVED: ReadonlySet<string> = new Set([
  ...TAVERN_V2_STRING_FIELDS,
  'alternate_greetings',
  'tags',
  'character_book',
  'extensions',
])

/** 不写入扁平 `data` 的 chara 顶层键 */
const TAVERN_V2_SKIP_PASSTHROUGH: ReadonlySet<string> = new Set([
  'spec',
  'spec_version',
])

function strField(card: Record<string, unknown>, key: string): string {
  const v = card[key]
  if (typeof v === 'string') return v
  if (v == null) return ''
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  return ''
}

function stringListField(
  card: Record<string, unknown>,
  key: string,
  maxItems: number,
): string[] {
  const v = card[key]
  if (Array.isArray(v)) {
    return v.map((x) => String(x)).filter(Boolean).slice(0, maxItems)
  }
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(/\n/)
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, maxItems)
  }
  return []
}

function tagsField(card: Record<string, unknown>): string[] {
  const v = card.tags
  if (Array.isArray(v)) {
    return v.map((x) => String(x).trim()).filter(Boolean).slice(0, 512)
  }
  if (typeof v === 'string' && v.trim()) {
    return v
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean)
  }
  return []
}

/**
 * 将任意扁平 `card` 规范为 TavernCardV2 的 `data` 对象：
 * 补全缺省字符串、数组、`extensions`、`character_book`（若有），并保留未知扩展键。
 */
export function normalizeTavernCardV2Data(
  card: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of TAVERN_V2_STRING_FIELDS) {
    let s = strField(card, k)
    if (k === 'character_version' && !s.trim()) s = '2.0'
    out[k] = s
  }
  out.alternate_greetings = stringListField(card, 'alternate_greetings', 256)
  out.tags = tagsField(card)
  const cb = card.character_book
  if (cb && typeof cb === 'object' && !Array.isArray(cb) && cb !== null) {
    out.character_book = cb
  }
  const ex = card.extensions
  if (ex && typeof ex === 'object' && !Array.isArray(ex) && ex !== null) {
    out.extensions = { ...(ex as Record<string, unknown>) }
  } else {
    out.extensions = {}
  }
  for (const [k, v] of Object.entries(card)) {
    if (TAVERN_V2_RESERVED.has(k) || TAVERN_V2_SKIP_PASSTHROUGH.has(k)) continue
    out[k] = v
  }
  return out
}

export function wrapCardForCharaChunk(card: Record<string, unknown>): string {
  const data = normalizeTavernCardV2Data(card)
  const payload = {
    spec: 'chara_card_v2' as const,
    spec_version: '2.0' as const,
    data,
  }
  return JSON.stringify(payload)
}

export function cardFromCharaJson(parsed: unknown): Record<string, unknown> {
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('chara 元数据不是 JSON 对象')
  }
  const o = parsed as Record<string, unknown>
  if (
    o.spec === 'chara_card_v2' &&
    o.data &&
    typeof o.data === 'object' &&
    !Array.isArray(o.data)
  ) {
    return normalizeTavernCardV2Data(o.data as Record<string, unknown>)
  }
  return normalizeTavernCardV2Data({ ...o })
}

/** 从 PNG 的 chara（tEXt / zTXt）解析出扁平 card */
export function extractCardFromPng(pngBuffer: Buffer): Record<string, unknown> {
  const chunks = readPngChunks(pngBuffer)
  for (const c of chunks) {
    if (c.type !== 'zTXt') continue
    const p = parseZtxtKeyword(c.data)
    if (!p || p.keyword !== 'chara') continue
    try {
      const plain = inflateSync(p.compressed)
      const b64 = plain.toString('latin1')
      const jsonStr = Buffer.from(b64, 'base64').toString('utf8')
      return cardFromCharaJson(JSON.parse(jsonStr) as unknown)
    } catch {
      continue
    }
  }
  for (const c of chunks) {
    if (c.type !== 'tEXt') continue
    const p = parseTexKeyword(c.data)
    if (!p || p.keyword !== 'chara') continue
    const b64 = p.rest.toString('latin1')
    const jsonStr = Buffer.from(b64, 'base64').toString('utf8')
    return cardFromCharaJson(JSON.parse(jsonStr) as unknown)
  }
  throw new Error('PNG 中未找到 chara 角色卡元数据')
}

/** 移除已有 chara 的 tEXt/zTXt，在 IEND 前写入新的 chara（tEXt，Base64 JSON） */
export function embedCharaInPng(pngBuffer: Buffer, card: Record<string, unknown>): Buffer {
  const chunks = readPngChunks(pngBuffer)
  const filtered = chunks.filter((c) => {
    if (c.type === 'tEXt') {
      const p = parseTexKeyword(c.data)
      return !p || p.keyword !== 'chara'
    }
    if (c.type === 'zTXt') {
      const p = parseZtxtKeyword(c.data)
      return !p || p.keyword !== 'chara'
    }
    return true
  })
  const iendIdx = filtered.findIndex((c) => c.type === 'IEND')
  if (iendIdx < 0) {
    throw new Error('PNG 缺少 IEND')
  }
  const json = wrapCardForCharaChunk(card)
  const b64 = Buffer.from(json, 'utf8').toString('base64')
  const tdata = Buffer.concat([
    Buffer.from('chara', 'latin1'),
    Buffer.from([0]),
    Buffer.from(b64, 'ascii'),
  ])
  const charaChunk: PngChunk = { type: 'tEXt', data: tdata }
  const next: PngChunk[] = [
    ...filtered.slice(0, iendIdx),
    charaChunk,
    ...filtered.slice(iendIdx),
  ]
  return buildPngFromChunks(next)
}
