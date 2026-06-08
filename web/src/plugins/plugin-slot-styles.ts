/** 按插件 id 注入/更新 <style data-plugin-styles>，供 slot 按钮等自定义样式 */
export function registerPluginStyles(pluginId: string, css: string): void {
  const id = pluginId.trim()
  const text = css.trim()
  if (!id || !text) return

  const attr = 'data-plugin-styles'
  let el = document.querySelector<HTMLStyleElement>(
    `style[${attr}="${CSS.escape(id)}"]`,
  )
  if (!el) {
    el = document.createElement('style')
    el.setAttribute(attr, id)
    document.head.appendChild(el)
  }
  el.textContent = text
}
