#!/usr/bin/env node
// evenhub-dev-harness — Automation Server (범용).
// 헤드리스 Chrome 로 하니스 페이지를 띄우고, 공식 evenhub-simulator 와 동일한 automation API 를
// 노출한다 → 시뮬용 E2E 러너를 무수정 재사용(--base http://127.0.0.1:<port>).
//
// API 패리티:
//   GET  /api/ping                → "pong"
//   GET  /api/console[?since_id]  → {entries:[{id,level,message,ts}]}
//   GET  /api/screenshot/glasses  → 안경 캔버스 PNG (--glass 셀렉터, 기본 #glass)
//   POST /api/input {action}      → click|up|down|double_click|gps → 하니스 버튼 클릭
//
// 사용:
//   node serve.mjs --widget http://127.0.0.1:5173/harness/ --port 9899 [--glass "#glass"]
// 전제: 하니스 페이지를 서빙하는 dev 서버(Vite 등) 기동 + 시스템 Chrome 설치(playwright-core 는 channel:'chrome' 사용).

import http from 'node:http'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

// playwright-core 해석: ① kit 기준(정상 설치/git-dep) ② 실행 cwd 기준(file: 심링크 설치 등
// 의존성이 소비 프로젝트 쪽에만 있는 경우). 둘 다 실패하면 설치 안내 후 종료.
async function loadChromium() {
  try { return (await import('playwright-core')).chromium } catch { /* fallthrough */ }
  try {
    const req = createRequire(process.cwd() + '/package.json')
    return (await import(pathToFileURL(req.resolve('playwright-core')).href)).chromium
  } catch {
    process.stderr.write('[harness-serve] playwright-core 미설치 — `npm install playwright-core` 후 재실행\n')
    process.exit(1)
  }
}
const chromium = await loadChromium()

const args = Object.fromEntries(
  process.argv.slice(2).reduce((acc, a, i, arr) => {
    if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1]])
    return acc
  }, []),
)
const WIDGET = args.widget ?? 'http://127.0.0.1:5173/harness/'
const PORT = Number(args.port ?? 9899)
const GLASS = args.glass ?? '#glass'

const ACTION_BTN = { click: '#bClick', up: '#bUp', down: '#bDown', double_click: '#bDouble', gps: '#bGeo' }

const console_entries = []
let nextId = 1

const browser = await chromium.launch({ channel: 'chrome', headless: true })
const page = await browser.newPage({ viewport: { width: 620, height: 720 } })
page.on('console', (msg) => {
  console_entries.push({ id: nextId++, level: msg.type(), message: msg.text(), ts: Date.now() })
  if (console_entries.length > 1000) console_entries.shift()
})
page.on('pageerror', (err) => {
  console_entries.push({ id: nextId++, level: 'error', message: '[pageerror] ' + err.message, ts: Date.now() })
})
await page.goto(WIDGET, { waitUntil: 'domcontentloaded' })
process.stderr.write(`[harness-serve] loaded ${WIDGET} — automation on :${PORT}\n`)

const sendJson = (res, obj, code = 200) => {
  const body = Buffer.from(JSON.stringify(obj))
  res.writeHead(code, { 'Content-Type': 'application/json', 'Content-Length': body.length })
  res.end(body)
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)
  try {
    if (url.pathname === '/api/ping') { res.writeHead(200); return res.end('pong') }

    if (url.pathname === '/api/console') {
      const since = Number(url.searchParams.get('since_id') ?? 0)
      return sendJson(res, { entries: since ? console_entries.filter((e) => e.id > since) : console_entries })
    }

    if (url.pathname === '/api/screenshot/glasses') {
      // ?stats=1 → 발광 픽셀 카운트 JSON. smoke 판정은 HTTP 200 이 아니라 이 하한선으로 할 것
      // (빈 캔버스도 PNG 200 이 나오므로 200 판정은 거짓양성).
      if (url.searchParams.get('stats') === '1') {
        const stats = await page.evaluate((sel) => {
          const c = document.querySelector(sel)
          if (!c) return null
          const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data
          let lit = 0
          for (let i = 0; i < d.length; i += 4) if (d[i] || d[i + 1] || d[i + 2]) lit++
          return { width: c.width, height: c.height, litPixels: lit, totalPixels: c.width * c.height }
        }, GLASS)
        if (!stats) return sendJson(res, { error: `canvas not found: ${GLASS}` }, 500)
        return sendJson(res, stats)
      }
      const el = page.locator(GLASS)
      // 명시 타임아웃: 위젯 상태와 무관하게 빨리·명확히 실패(무한 대기 방지)
      const png = await el.screenshot({ type: 'png', timeout: 10_000 })
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
      return res.end(png)
    }

    if (url.pathname === '/api/input' && req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      let action = ''
      try { action = JSON.parse(raw || '{}').action } catch { /* */ }
      const sel = ACTION_BTN[action]
      if (!sel) return sendJson(res, { error: `unknown action: ${action}` }, 400)
      await page.click(sel)
      return sendJson(res, { ok: true, action })
    }

    sendJson(res, { error: 'not found' }, 404)
  } catch (e) {
    sendJson(res, { error: String(e?.message ?? e) }, 500)
  }
})

server.listen(PORT, '127.0.0.1', () => process.stderr.write(`[harness-serve] listening http://127.0.0.1:${PORT}\n`))

const shutdown = async () => { try { await browser.close() } catch { /* */ } ; process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
