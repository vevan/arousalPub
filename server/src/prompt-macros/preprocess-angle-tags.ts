const LEGACY_ANGLE_TAGS: Record<string, string> = {
  user: '{{user}}',
  bot: '{{char}}',
  char: '{{char}}',
}

/** Legacy `<USER>` / `<BOT>` / `<CHAR>` → `{{user}}` / `{{char}}` */
export function preprocessLegacyAngleTags(text: string): string {
  if (!text.includes('<')) return text
  return text.replace(/<(USER|BOT|CHAR)>/gi, (_, tag: string) => {
    return LEGACY_ANGLE_TAGS[tag.toLowerCase()] ?? `<${tag}>`
  })
}
