#!/usr/bin/env node
// evenhub-dev-harness — Automation Server (범용).
// 헤드리스 Chrome 로 하니스 페이지를 띄우고, 공식 evenhub-simulator 와 동일한 automation API 를
// 노출한다 → 시뮬용 E2E 러너를 무수정 재사용(--base http://127.0.0.1:<port>).
//
// API 패리티:
//   GET  /api/ping                → "pong"
//   GET  /api/console[?since_id]  → {entries:[{id,level,message,ts}]}
//   GET  /api/screenshot/glasses  → 안경 캔버스 PNG (--glass 셀렉터, 기본 #glass). ?stats=1 → 발광픽셀 JSON
//   GET  /api/screenshot/webview  → 전체 페이지 PNG (폰측 UI 포함 — 공식 시뮬 패리티)
//   POST /api/input {action}      → click|up|down|double_click|gps → 하니스 버튼 클릭
// 폰측 DOM 구동(위젯이 폰 UI 플로우를 요구할 때 — 목적지 입력·제출 등):
//   POST /api/dom {selector, action:'click'|'fill'|'submit', value?}  → evaluate 기반(숨김 요소에도 동작)
//   GET  /api/dom/text?selector=  → {exists, visible, text, value}
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

    if (url.pathname === '/api/screenshot/webview') {
      const png = await page.screenshot({ type: 'png', timeout: 10_000 })
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length })
      return res.end(png)
    }

    // 폰측 DOM 구동(F-11): 위젯의 폰 UI 플로우(입력·제출·후보 클릭)를 automation 으로 태운다.
    // page.evaluate 직접 조작이라 display:none(#app 숨김) 요소에도 동작. 상태 확인은 /api/dom/text.
    if (url.pathname === '/api/dom' && req.method === 'POST') {
      let raw = ''
      for await (const chunk of req) raw += chunk
      let body = {}
      try { body = JSON.parse(raw || '{}') } catch { /* */ }
      const { selector, action, value } = body
      if (!selector || !action) return sendJson(res, { error: 'selector, action 필수' }, 400)
      const result = await page.evaluate(({ selector, action, value }) => {
        const el = document.querySelector(selector)
        if (!el) return { error: `not found: ${selector}` }
        if (action === 'click') { el.click(); return { ok: true } }
        if (action === 'fill') {
          el.value = value ?? ''
          el.dispatchEvent(new Event('input', { bubbles: true }))
          el.dispatchEvent(new Event('change', { bubbles: true }))
          return { ok: true }
        }
        if (action === 'submit') {
          const form = el.closest('form') ?? (el.tagName === 'FORM' ? el : null)
          if (form) { form.requestSubmit ? form.requestSubmit() : form.submit(); return { ok: true } }
          // form 없으면 Enter 키 이벤트로 대체(입력창 keydown 핸들러 위젯 대응)
          el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
          el.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', bubbles: true }))
          return { ok: true, note: 'no form — Enter key dispatched' }
        }
        return { error: `unknown action: ${action}` }
      }, { selector, action, value })
      return sendJson(res, result, result.error ? 400 : 200)
    }

    if (url.pathname === '/api/dom/text') {
      const selector = url.searchParams.get('selector')
      if (!selector) return sendJson(res, { error: 'selector 필수' }, 400)
      const info = await page.evaluate((sel) => {
        const el = document.querySelector(sel)
        if (!el) return { exists: false }
        const st = getComputedStyle(el)
        return {
          exists: true,
          visible: st.display !== 'none' && st.visibility !== 'hidden',
          text: (el.textContent ?? '').slice(0, 2000),
          value: 'value' in el ? String(el.value).slice(0, 500) : undefined,
        }
      }, selector)
      return sendJson(res, info)
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
