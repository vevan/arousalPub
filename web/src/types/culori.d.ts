/** culori 包 exports 与 @types/culori 在 bundler moduleResolution 下不兼容时的声明 */
declare module 'culori' {
  export interface OklchColor {
    mode: 'oklch'
    l?: number
    c?: number
    h?: number
  }

  export function converter(mode: string): (color: unknown) => OklchColor | undefined
  export function formatCss(color: unknown): string
  export function formatHex(color: unknown): string | undefined
  export function parse(color: string): unknown
}
