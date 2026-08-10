// evenhub-dev-harness — mock EvenAppBridge (범용).
// 실 와이어 프로토콜(공식 시뮬 캡처 기반)을 재현해 Even Hub 위젯을 "무수정"으로 브라우저에서 구동한다.
//   Widget→Host: window.flutter_inappwebview.callHandler('evenAppMessage', JSON({type,method,data})) → Promise(결과)
//   Host→Widget: window.dispatchEvent(new CustomEvent('evenHubEvent', {detail:{jsonData, textEvent|sysEvent|listEvent}}))
// 경계: 이 렌더러는 펌웨어 픽셀 재현이 아님(근사) → 로직·입력·상호작용 검증용. 렌더 정합은 공식시뮬/실기.
// ⚠ 이 모듈은 SDK 를 정적 import 하지 않는다(브릿지 mock 을 SDK init 전에 심어야 하므로).
// 프로토콜·제약 레퍼런스: ../SDK.md · 통합 방법: ../README.md

interface Rect { x: number; y: number; w: number; h: number; id: number }
interface ListBox { rect: Rect; items: string[] }
// 텍스트 컨테이너 근사 렌더: border(펌웨어 borderRadius/Width) + content(textContainerUpgrade 로 갱신).
interface TextBox { rect: Rect; borderW: number; borderR: number; content: string }

export interface HarnessOptions {
  /** 위젯 엔트리 로더. mock 브릿지가 심긴 뒤 호출된다. 예: () => import('/src/main.ts') */
  widgetEntry: () => Promise<unknown>
  /** 안경 캔버스(576×288). 셀렉터 또는 요소. 기본 '#glass' */
  glass?: string | HTMLCanvasElement
  /** 로그 패널 요소. 셀렉터 또는 요소. 기본 '#log'. null 로 끄기 가능 */
  log?: string | HTMLElement | null
  /** GPS 입력 필드("lat,lon"). 셀렉터 또는 요소. 기본 '#geo' */
  geoInput?: string | HTMLInputElement | null
  /** 입력 버튼 셀렉터. 기본 { click:'#bClick', up:'#bUp', down:'#bDown', double:'#bDouble', geo:'#bGeo' } */
  buttons?: Partial<Record<'click' | 'up' | 'down' | 'double' | 'geo', string>>
  /** textEvent 를 실을 캡처 컨테이너(isEventCapture:1) id/이름. 기본 { containerID: 11, containerName: 'cap' } */
  capture?: { containerID: number; containerName: string }
  /** getGlassesInfo 응답 오버라이드 */
  glassesInfo?: Record<string, unknown>
  /** getUserInfo 응답 오버라이드 */
  userInfo?: Record<string, unknown>
  /** geoInput 이 없거나 파싱 실패 시 기본 좌표 [lat, lon]. 기본 서울시청 */
  defaultGeo?: [number, number]
  /** window.__EVEN_HUB_APP_ID__ 값. 기본 'harness' */
  appId?: string
  /** console.log 를 로그 패널로 미러(위젯 dlog 가시화). 기본 true */
  mirrorConsole?: boolean
  /** localStorage 키 프리픽스(set/getLocalStorage). 기본 'h_' */
  storagePrefix?: string
  /** 알 수 없는 브릿지 메서드 처리 훅(반환값이 그대로 응답). 미지정 시 null 응답 + 로그 */
  onUnknownMethod?: (method: string, data: Record<string, unknown>) => unknown
}

export interface HarnessApi {
  /** 임의 evenHubEvent 주입(Host→Widget) */
  fireEvent: (detail: Record<string, unknown>) => void
  /** 캡처 텍스트 컨테이너 이벤트. eventType: CLICK 0 / SCROLL_TOP 1 / SCROLL_BOTTOM 2 / DOUBLE 3 */
  textEvent: (eventType: number) => void
  /** 시스템 이벤트(eventSource:1). 예: DOUBLE_CLICK=3 */
  sysEvent: (eventType: number) => void
  /** appLocationChanged 1회 주입(연속 타이머 없음) */
  pushGeo: (lat?: number, lon?: number) => void
  /** 캔버스 강제 재렌더 */
  redraw: () => void
}

function resolve<T extends Element>(v: string | T | null | undefined, fallback: string): T | null {
  if (v === null) return null
  if (typeof v === 'string') return document.querySelector<T>(v)
  if (v) return v
  return document.querySelector<T>(fallback)
}

export async function startHarness(opts: HarnessOptions): Promise<HarnessApi> {
  const glassEl = resolve<HTMLCanvasElement>(opts.glass, '#glass')
  if (!glassEl) throw new Error('harness: glass canvas not found (options.glass / #glass)')
  const glass: HTMLCanvasElement = glassEl  // 함수 선언 클로저에서도 non-null 유지
  const gctx = glass.getContext('2d')!
  const logEl = resolve<HTMLElement>(opts.log, '#log')
  const geoEl = resolve<HTMLInputElement>(opts.geoInput, '#geo')
  const capture = opts.capture ?? { containerID: 11, containerName: 'cap' }
  const [defLat, defLon] = opts.defaultGeo ?? [37.5665, 126.978]
  const prefix = opts.storagePrefix ?? 'h_'

  const rects = new Map<number, Rect>()
  const images = new Map<number, HTMLImageElement>()
  const textBoxes = new Map<number, TextBox>()
  let listBox: ListBox | null = null

  // ── 로그 패널 ─────────────────────────────────────────────
  function pane(kind: 'send' | 'recv' | 'event' | 'info', msg: string): void {
    if (!logEl) return
    const line = document.createElement('div')
    line.className = 'ln ' + kind
    const ts = new Date().toISOString().slice(11, 19)
    line.textContent = `${ts}  ${kind.toUpperCase().padEnd(5)}  ${msg}`
    logEl.appendChild(line)
    while (logEl.childElementCount > 500) logEl.removeChild(logEl.firstChild!)
    logEl.scrollTop = logEl.scrollHeight
  }
  // 위젯 dlog(console.log) 도 로그 패널로 미러
  if (opts.mirrorConsole !== false) {
    const _clog = console.log.bind(console)
    console.log = (...a: unknown[]) => { try { pane('info', a.map(String).join(' ')) } catch { /* */ } ; _clog(...a) }
  }

  // ── 렌더러 ────────────────────────────────────────────────
  function setRects(data: { imageObject?: unknown[]; textObject?: unknown[]; listObject?: unknown[] }): void {
    rects.clear(); listBox = null; textBoxes.clear()
    const all = [...(data.imageObject ?? []), ...(data.textObject ?? []), ...(data.listObject ?? [])] as Array<Record<string, number>>
    for (const o of all) rects.set(o.containerID, { x: o.xPosition, y: o.yPosition, w: o.width, h: o.height, id: o.containerID })
    // 텍스트 컨테이너: border(펌웨어 프레임) + 초기 content 저장.
    for (const o of (data.textObject ?? []) as Array<Record<string, number> & { content?: string }>) {
      textBoxes.set(o.containerID, {
        rect: { x: o.xPosition, y: o.yPosition, w: o.width, h: o.height, id: o.containerID },
        borderW: Number(o.borderWidth ?? 0), borderR: Number(o.borderRadius ?? 0), content: String(o.content ?? ''),
      })
    }
    const lo = (data.listObject ?? [])[0] as { xPosition: number; yPosition: number; width: number; height: number; itemContainer?: { itemName?: string[] } } | undefined
    if (lo) listBox = { rect: { x: lo.xPosition, y: lo.yPosition, w: lo.width, h: lo.height, id: -1 }, items: lo.itemContainer?.itemName ?? [] }
  }
  function roundRectPath(x: number, y: number, w: number, h: number, r: number): void {
    const rr = Math.min(r, w / 2, h / 2)
    gctx.beginPath()
    gctx.moveTo(x + rr, y); gctx.arcTo(x + w, y, x + w, y + h, rr); gctx.arcTo(x + w, y + h, x, y + h, rr)
    gctx.arcTo(x, y + h, x, y, rr); gctx.arcTo(x, y, x + w, y, rr); gctx.closePath()
  }
  function redraw(): void {
    gctx.fillStyle = '#000'; gctx.fillRect(0, 0, glass.width, glass.height)
    for (const [id, img] of images) { const r = rects.get(id); if (r && img.complete && img.naturalWidth) gctx.drawImage(img, r.x, r.y, r.w, r.h) }
    // 텍스트 컨테이너: 펌웨어 border(radius/width) + content 근사 렌더(프레이밍 확인용).
    for (const tb of textBoxes.values()) {
      if (tb.borderW > 0) {
        gctx.strokeStyle = '#39ff88'; gctx.lineWidth = tb.borderW
        roundRectPath(tb.rect.x, tb.rect.y, tb.rect.w, tb.rect.h, tb.borderR); gctx.stroke()
      }
      if (tb.content) {  // 텍스트 근사(줄바꿈만; 폰트 정합은 실기)
        gctx.fillStyle = '#39ff88'; gctx.font = '15px system-ui, sans-serif'; gctx.textBaseline = 'top'
        const pad = 8; let y = tb.rect.y + pad
        for (const ln of tb.content.split('\n')) { if (y + 18 > tb.rect.y + tb.rect.h) break; gctx.fillText(ln.slice(0, 72), tb.rect.x + pad, y); y += 19 }
      }
    }
    if (listBox) {  // OS List 텍스트 근사 렌더
      gctx.strokeStyle = '#39ff88'; gctx.lineWidth = 1
      gctx.strokeRect(listBox.rect.x, listBox.rect.y, listBox.rect.w, listBox.rect.h)
      gctx.fillStyle = '#39ff88'; gctx.font = '16px system-ui, sans-serif'; gctx.textBaseline = 'top'
      listBox.items.slice(0, 12).forEach((it, i) => gctx.fillText(it.slice(0, 60), listBox!.rect.x + 8, listBox!.rect.y + 8 + i * 20))
    }
  }
  function drawImageData(containerID: number, bytes: number[]): void {
    const blob = new Blob([new Uint8Array(bytes)], { type: 'image/png' })
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => { images.set(containerID, img); redraw(); URL.revokeObjectURL(url) }
    img.src = url
  }

  // ── 입력 mock ─────────────────────────────────────────────
  function geoParts(): [number, number] {
    const [lat, lon] = (geoEl?.value ?? `${defLat},${defLon}`).split(',').map(Number)
    return [Number.isFinite(lat) ? lat : defLat, Number.isFinite(lon) ? lon : defLon]
  }
  // GPS 1회 주입(연속 타이머 X). 위치는 반드시 appLocationChanged 로만(evenHubEvent 로 쏘면 위젯이 상호작용으로 오해).
  function pushGeo(lat?: number, lon?: number): void {
    const [glat, glon] = lat != null && lon != null ? [lat, lon] : geoParts()
    window.dispatchEvent(new CustomEvent('appLocationChanged', { detail: { latitude: glat, longitude: glon, speed: 0 } }))
    pane('event', `appLocationChanged ${glat},${glon} (1회)`)
  }

  // IMU mock: 켜면 Sys IMU_DATA 이벤트 저빈도 방출. eventSource=1.
  let imuTimer = 0
  function startImu(): void {
    if (imuTimer) return
    let k = 0
    imuTimer = window.setInterval(() => {
      k += 1
      const x = Math.sin(k / 5), y = Math.cos(k / 7), z = 1
      fireEvent({ jsonData: { imuData: { x, y, z }, eventSource: 1 }, sysEvent: { imuData: { x, y, z }, eventSource: 1 } })
    }, 500)
  }
  function stopImu(): void { if (imuTimer) { clearInterval(imuTimer); imuTimer = 0 } }

  // ── 이벤트 주입(Host→Widget) ──────────────────────────────
  function fireEvent(detail: Record<string, unknown>): void {
    window.dispatchEvent(new CustomEvent('evenHubEvent', { detail }))
    pane('event', JSON.stringify(detail).slice(0, 120))
  }
  // 캡처 텍스트 컨테이너 스크롤/클릭. eventType: CLICK0/SCROLL_TOP1/SCROLL_BOTTOM2/DOUBLE3
  function textEvt(eventType: number): void {
    const c = { containerID: capture.containerID, containerName: capture.containerName, eventType }
    fireEvent({ jsonData: c, textEvent: c })
  }
  function sysEvt(eventType: number): void { fireEvent({ jsonData: { eventType, eventSource: 1 }, sysEvent: { eventType, eventSource: 1 } }) }

  // ── callHandler(method 디스패치) ─────────────────────────
  async function handle(method: string, data: Record<string, unknown>): Promise<unknown> {
    pane('recv', method + (method === 'updateImageRawData' ? ` #${(data as { containerID: number }).containerID}` : ''))
    switch (method) {
      case 'getGlassesInfo': return opts.glassesInfo ?? { model: 'g2', sn: 'HARNESS-0001', status: { batteryLevel: 88, connectType: 'connected', isCharging: false, isInCase: false, isWearing: true, sn: 'HARNESS-0001' } }
      case 'getUserInfo': return opts.userInfo ?? { uid: 'harness', name: 'Harness', avatar: '', country: 'KR' }
      case 'setLocalStorage': try { localStorage.setItem(prefix + (data as { key: string }).key, (data as { value: string }).value) } catch { /* */ } return true
      case 'getLocalStorage': try { return localStorage.getItem(prefix + (data as { key: string }).key) } catch { return null }
      case 'createStartUpPageContainer': images.clear(); setRects(data); redraw(); return 0  // StartUpPageCreateResult.success
      case 'rebuildPageContainer': images.clear(); setRects(data); redraw(); return true
      case 'updateImageRawData': drawImageData((data as { containerID: number }).containerID, (data as { imageData: number[] }).imageData); return 'success'
      case 'textContainerUpgrade': {  // 텍스트 컨테이너 내용 갱신 → 근사 렌더
        const tb = textBoxes.get((data as { containerID: number }).containerID)
        if (tb) { tb.content = String((data as { content?: string }).content ?? ''); redraw() }
        return true
      }
      case 'shutDownPageContainer': pane('info', 'shutDown(앱 종료 요청)'); return true
      // 입력 mock — 공식 시뮬 미지원 6기능(SDK.md 능력 매트릭스)을 하니스가 구현
      case 'getAppLocation': { const [lat, lon] = geoParts(); return { latitude: lat, longitude: lon, speed: 0 } }
      case 'startAppLocationUpdates': return true  // GPS 자동주입 안 함(opt-in) — 주입은 pushGeo/버튼으로 1회씩.
      case 'stopAppLocationUpdates': return true
      case 'audioControl': return false
      case 'imuControl': { const on = (data as { isOpen?: boolean }).isOpen; if (on) startImu(); else stopImu(); return true }
      // 카메라/앨범: 고정 PNG 헤더 바이트 반환(실 촬영 없음). 위젯이 이미지 경로를 태우는지만 검증용.
      case 'pickImageFromAlbum':
      case 'captureImageFromCamera':
        return { path: 'harness:mock-image.png', bytes: [137, 80, 78, 71, 13, 10, 26, 10] }
      default:
        if (opts.onUnknownMethod) return opts.onUnknownMethod(method, data)
        pane('info', 'unknown method: ' + method); return null
    }
  }

  // ── 브릿지 mock 심기(SDK init 전) ────────────────────────
  ;(window as unknown as { flutter_inappwebview: unknown }).flutter_inappwebview = {
    callHandler: (name: string, payload: string): Promise<unknown> => {
      let p: { type?: string; method?: string; data?: Record<string, unknown> } = {}
      try { p = JSON.parse(payload) } catch { /* */ }
      if (name === 'evenAppMessage' && p.type === 'call_even_app_method' && p.method) {
        pane('send', p.method)
        return handle(p.method, p.data ?? {})
      }
      // 비-evenAppMessage 채널(listen_even_app_data 등 구독/기타)도 통합 진단 위해 로그에 표기
      pane('send', `${name} (기타 채널)` + (p.method ? ` method=${p.method}` : ''))
      return Promise.resolve(true)
    },
    // 일부 위젯 래퍼는 callHandler 대신 postMessage 로 evenAppMessage 를 보낸다(fire-and-forget).
    // 미구현 시 "Flutter handler not available" 류 실패 → 동일 디스패치로 수용(응답은 버려짐 —
    // 반환값이 필요한 호출은 callHandler 를 써야 한다).
    postMessage: (payload: string): void => {
      let p: { type?: string; method?: string; data?: Record<string, unknown> } = {}
      try { p = JSON.parse(payload) } catch { /* */ }
      if (p.type === 'call_even_app_method' && p.method) {
        pane('send', `${p.method} (postMessage)`)
        void handle(p.method, p.data ?? {})
        return
      }
      pane('info', 'postMessage(비표준 페이로드 무시): ' + String(payload).slice(0, 80))
    },
  }
  ;(window as unknown as { __EVEN_HUB_APP_ID__: string }).__EVEN_HUB_APP_ID__ = opts.appId ?? 'harness'

  // 입력 버튼 배선(존재하는 버튼만)
  const btn = { click: '#bClick', up: '#bUp', down: '#bDown', double: '#bDouble', geo: '#bGeo', ...(opts.buttons ?? {}) }
  const bind = (sel: string | undefined, fn: () => void) => { if (sel) document.querySelector(sel)?.addEventListener('click', fn) }
  bind(btn.click, () => textEvt(0))
  bind(btn.up, () => textEvt(1))     // SCROLL_TOP = 이전
  bind(btn.down, () => textEvt(2))   // SCROLL_BOTTOM = 다음
  bind(btn.double, () => sysEvt(3))  // DOUBLE_CLICK
  bind(btn.geo, () => { const [lat, lon] = geoParts(); pane('info', `GPS 주입 ${lat},${lon}`); pushGeo() })

  pane('info', 'harness ready — 위젯 로드 중…')
  // ready 이벤트(리스너 등록 타이밍 대비 몇 회 재발) + 위젯 로드
  const ready = () => window.dispatchEvent(new CustomEvent('evenAppBridgeReady', { detail: {} }))
  ready()
  // 위젯 엔트리 로드(이 시점엔 mock 브릿지가 window 에 존재)
  await opts.widgetEntry()
  for (let i = 1; i <= 5; i++) setTimeout(ready, i * 150)

  return { fireEvent, textEvent: textEvt, sysEvent: sysEvt, pushGeo, redraw }
}
