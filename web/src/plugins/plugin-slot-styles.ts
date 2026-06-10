/** 按插件 id 注入/更新 <style data-plugin-styles>，供 slot 按钮等自定义样式 */
export function registerPluginStyles(pluginId: string, css: string): void {
  const id = pluginId.trim()
  if (!id) return

  const text = css.trim()
  const attr = 'data-plugin-styles'
  const selector = `style[${attr}="${CSS.escape(id)}"]`
  const existing = document.querySelector<HTMLStyleElement>(selector)

  if (!text) {
    existing?.remove()
    return
  }

  let el = existing
  if (!el) {
    el = document.createElement('style')
    el.setAttribute(attr, id)
    document.head.appendChild(el)
  }
  el.textContent = text
}
