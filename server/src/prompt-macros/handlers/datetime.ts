import type { MacroHandler, PromptMacroContext } from '../types.js'

function formatParts(ctx: PromptMacroContext): {
  date: string
  time: string
  datetime: string
} {
  const d = ctx.now
  const locale = ctx.locale || 'zh-CN'
  const date = new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d)
  const time = new Intl.DateTimeFormat(locale, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(d)
  const datetime = `${date} ${time}`
  return { date, time, datetime }
}

export const expandDatetimeMacros: MacroHandler = (text, ctx) => {
  if (!text.includes('{{')) return text
  const { date, time, datetime } = formatParts(ctx)
  let out = text
  out = out.replace(/\{\{\s*datetime\s*\}\}/gi, () => datetime)
  out = out.replace(/\{\{\s*date\s*\}\}/gi, () => date)
  out = out.replace(/\{\{\s*time\s*\}\}/gi, () => time)
  return out
}
