import { chromium } from 'playwright'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1280, height: 1200 },
  deviceScaleFactor: 2,
})
const page = await ctx.newPage()
const url = `file:///${process.cwd().replace(/\\/g, '/')}/_design/demo-v2.html`
await page.goto(url)

const chatFrame = await page.locator('.chat-frame')
await chatFrame.screenshot({ path: '_design/demo-v2-chat.png' })

await browser.close()
console.log('Done')
