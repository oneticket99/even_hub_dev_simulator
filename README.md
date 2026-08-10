# evenhub-dev-harness — Even Hub 위젯 범용 Dev 시뮬레이터

> 🇰🇷 한국어(현재 문서) · 🇬🇧 [English](README.en.md) — SDK 레퍼런스: [한국어](SDK.md) · [English](SDK.en.md)

Even Realities **Even Hub 위젯**(G2 스마트글래스 앱)을 **무수정으로 브라우저에서 구동**하는 개발 하니스.
공식 `evenhub-simulator`(네이티브·폐쇄)가 못 하는 것을 메꾼다:

- **입력 mock**: GPS·IMU·카메라·앨범 (공식 시뮬 미지원 6기능 — [SDK.md](SDK.md) 능력 매트릭스)
- **분할 UI**: 안경 캔버스(576×288) / 실시간 브릿지 로그 / 입력 패널(클릭·슬라이드·더블탭·GPS)
- **DevTools**: 웹페이지라 F12 기본 제공
- **automation API**: 공식 시뮬과 동일한 `/api/*` → 기존 E2E 러너 무수정 재사용
- **evenhub login 불필요**: 계정·포털 없이 로컬에서 즉시 구동(CI 친화)

정본 저장소: `oneticket99/even_hub_dev_simulator`

## 경계 (중요)

하니스 렌더러는 **펌웨어 픽셀 재현이 아니다(근사)**. 용도 = **로직·입력·상호작용 E2E**.
텍스트 폭·폰트·픽셀 정합의 최종 확인은 공식 시뮬 + 실기로 한다
(하니스만 믿으면 `sim green / device red` 거짓양성 위험).

## 구성

```
harness-kit/
  src/mockbridge.ts        # 핵심: mock EvenAppBridge + 캔버스 렌더러 + 입력 mock. startHarness(options)
  serve.mjs                # 헤드리스 Chrome automation 서버(공식 시뮬 API 패리티)
  template/index.html      # 하니스 페이지 템플릿(복사용)
  template/harness-main.ts # 부트스트랩 템플릿(widgetEntry 만 바꾸면 됨)
  sim/standalone_sim.py    # PyQt6 데스크톱 뷰(안경 뷰 + 설정 뷰 + 콘솔 도킹 패널)
  sim/requirements.txt     # PyQt6 의존성
  wirecapture.js           # 브릿지 와이어 프로토콜 관측 스크립트(조사용, 독립)
  SDK.md                   # Even Hub SDK / 와이어 프로토콜 레퍼런스(시뮬 범용 사용 시 참고)
```

## 개발용 로그·디버그 도구 제공

이 하니스는 위젯 개발에 필요한 **로그·디버그 도구를 기본 제공**한다:

- **실시간 브릿지 로그 패널**: 모든 Widget↔Host 통신을 방향·종류별 색상으로 스트리밍
  (`SEND` 브릿지 호출 / `RECV` 호스트 응답 / `EVENT` 주입 이벤트 / `INFO` 정보).
  **크롬 콘솔식 필터** 내장 — 텍스트 부분일치(`#logFilter`) + 종류별 토글(SEND/RECV/EVENT/INFO 버튼).
- **console.log 미러**: 위젯의 `console.log` 출력을 로그 패널로 미러 —
  폰 WebView 콘솔을 못 여는 문제를 브라우저에서 해소.
- **F12 DevTools**: 하니스는 웹페이지라 크롬 DevTools(중단점·네트워크·콘솔) 기본 제공.
- **원격 로그 폴링 API**: `GET /api/console[?since_id]` — 헤드리스 E2E·CI 에서 콘솔 로그를
  기계 판독(마커 assert).
- **와이어 프로토콜 관측**: `wirecapture.js` 를 아무 Even Hub WebView 표면에 주입해
  브릿지 호출·이벤트 전문을 캡처(미공개 API 조사용).
- **PyQt 스탠드얼론 뷰**: 안경 뷰·설정 뷰 각각에 JS 콘솔 캡처 패널 + DevTools 버튼.

## 동작 원리

Even Hub 위젯은 폰 Even 앱의 Flutter WebView 에서 실행되며, 호스트와 이 채널로 통신한다:

- Widget→Host: `window.flutter_inappwebview.callHandler('evenAppMessage', JSON({type,method,data}))` → Promise(결과)
- Host→Widget: `window.dispatchEvent(new CustomEvent('evenHubEvent', {detail}))` / `appLocationChanged` 등

`mockbridge.ts` 가 SDK 초기화 **전에** 이 브릿지를 mock 으로 심고, 그 다음 위젯 엔트리를 동적 import
한다. 위젯 입장에선 실 호스트와 구분 불가 → **위젯 코드 무수정**. `updateImageRawData` 의 PNG 바이트는
캔버스에 blit, 텍스트/리스트 컨테이너는 border+내용을 근사 렌더한다.

## 빠른 통합 (새 프로젝트, 5단계)

전제: Vite 기반 Even Hub 위젯 프로젝트(공식 `evenhub init` 구조: `index.html` + `src/main.ts`).

1. **kit 설치** — 아래 중 하나:
   ```bash
   npm install github:oneticket99/even_hub_dev_simulator   # git 의존성
   npm install /path/to/harness-kit                        # 로컬 경로
   # 또는 kit 디렉터리를 저장소에 통째로 복사(상대경로 import)
   ```
2. **하니스 페이지 생성**: `template/index.html` + `template/harness-main.ts` 를
   위젯 루트의 `harness/` 디렉터리로 복사.
3. **부트스트랩 수정**: `harness/harness-main.ts` 의 `widgetEntry` 를 자기 엔트리로:
   ```ts
   import { startHarness } from 'evenhub-dev-harness'   // 복사 사용 시: '../상대경로/src/mockbridge'
   await startHarness({ widgetEntry: () => import('/src/main.ts') })
   ```
   위젯의 이벤트 캡처 컨테이너(`isEventCapture:1`)가 id 11/이름 'cap' 이 아니면
   `capture: { containerID, containerName }` 옵션으로 일치시킨다(불일치 시 Click/Up/Down 버튼 무반응).
4. **육안 개발**: `npm run dev` 후 브라우저에서 `http://localhost:5173/harness/` 열기.
   버튼 = 링 조작(Up/Down=슬라이드, Click=클릭, Double=더블탭), GPS 주입은 1회성.
5. **자동 E2E**: 시스템 Chrome 설치 전제.
   ```bash
   node node_modules/evenhub-dev-harness/serve.mjs --widget http://127.0.0.1:5173/harness/ --port 9899
   curl http://127.0.0.1:9899/api/ping        # → pong
   ```
   기존에 공식 시뮬 automation API 로 짠 E2E 러너가 있으면 `--base http://127.0.0.1:9899` 로 그대로 돌린다.

## startHarness 옵션 레퍼런스

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `widgetEntry` | (필수) | 위젯 엔트리 로더. mock 브릿지 설치 후 호출. `() => import('/src/main.ts')` |
| `glass` | `'#glass'` | 안경 캔버스(576×288). 셀렉터 또는 요소 |
| `log` | `'#log'` | 로그 패널. `null` 이면 로그 UI 없이 동작 |
| `geoInput` | `'#geo'` | GPS 좌표 입력 필드(`"lat,lon"`) |
| `buttons` | `#bClick/#bUp/#bDown/#bDouble/#bGeo` | 입력 버튼 셀렉터 맵(존재하는 것만 배선) |
| `capture` | `{containerID:11, containerName:'cap'}` | textEvent 를 실을 캡처 컨테이너. **위젯과 일치 필수** |
| `glassesInfo` | g2/HARNESS-0001/88% | `getGlassesInfo` 응답 오버라이드 |
| `userInfo` | uid 'harness' | `getUserInfo` 응답 오버라이드 |
| `defaultGeo` | `[37.5665,126.978]` | geoInput 부재/파싱 실패 시 좌표 |
| `appId` | `'harness'` | `window.__EVEN_HUB_APP_ID__` |
| `mirrorConsole` | `true` | `console.log` 를 로그 패널로 미러 |
| `storagePrefix` | `'h_'` | set/getLocalStorage 키 프리픽스 |
| `onUnknownMethod` | — | 미구현 브릿지 메서드 훅(신규 SDK 메서드 실험용) |

반환 `HarnessApi`: `fireEvent(detail)` / `textEvent(type)` / `sysEvent(type)` / `pushGeo(lat?,lon?)` / `redraw()`
— 버튼 없이 스크립트로 입력을 주입할 때 사용.

## Automation API (serve.mjs)

공식 `evenhub-simulator --automation-port` 와 동일 계약:

| 경로 | 동작 |
|---|---|
| `GET /api/ping` | `"pong"` |
| `GET /api/console[?since_id=N]` | `{entries:[{id,level,message,ts}]}` — 페이지 콘솔/에러 버퍼(1000) |
| `GET /api/screenshot/glasses` | 안경 캔버스 PNG (`--glass` 셀렉터, 기본 `#glass`). `?stats=1` → `{litPixels,…}` JSON |
| `GET /api/screenshot/webview` | 전체 페이지 PNG(폰측 UI 포함) |
| `POST /api/input {"action":...}` | `click` \| `up` \| `down` \| `double_click` \| `gps`(하니스 전용) |
| `POST /api/dom {selector, action, value?}` | 폰측 DOM 구동: `click`/`fill`/`submit`. evaluate 기반 — 숨김 `#app` 요소에도 동작 |
| `GET /api/dom/text?selector=` | `{exists, visible, text, value}` — 폰 UI 상태 assert 용 |

**폰 UI 플로우 자동화**: 위젯이 폰측 DOM 상호작용(예: 목적지 입력→제출→후보 선택)을 요구하면
링 입력만으로는 흐름을 못 태운다 → `/api/dom` 으로 스크립트에서 입력·클릭을 주입:

```bash
curl -X POST :9899/api/dom -d '{"selector":"#dest-input","action":"fill","value":"서울역"}'
curl -X POST :9899/api/dom -d '{"selector":"#dest-input","action":"submit"}'
curl -X POST :9899/api/dom -d '{"selector":".candidate:first-child","action":"click"}'
curl ":9899/api/dom/text?selector=.route-status"   # 상태 assert
```

플래그: `--widget <하니스 URL>` `--port <포트>` `--glass <캔버스 셀렉터>`.

**smoke 판정 가이드(중요)**: 빈 캔버스도 스크린샷이 HTTP 200/정상 PNG 로 나온다 —
**200 판정은 거짓양성**. 판정은 반드시:
1. `GET /api/screenshot/glasses?stats=1` → `{litPixels, totalPixels}` 의 **발광 픽셀 하한선**
   (예: `litPixels > 500`)으로,
2. `/api/console` 의 위젯 `ready`/상태 **마커 문자열** assert 로,
3. 가능하면 **역검증**(위젯 마운트 요소 제거 등 고의 실패 조건에서 smoke 가 FAIL 하는지)까지.

## 트러블슈팅 (타 프로젝트 통합 시 실측 사례)

| 증상 | 원인 | 해법 |
|---|---|---|
| 위젯이 조용히 아무것도 안 함(브릿지 호출 0) | 위젯이 폰측 UI 마운트 루트(`#app` 등)를 요구하는데 하니스 페이지에 없음 | 템플릿의 숨김 `<div id="app">` 유지/추가. 다른 id 면 그에 맞출 것 |
| SPA 라우터 not-found → 위젯 미마운트 | 라우터가 `/harness/` 경로를 모름 | 부트스트랩에서 `history.replaceState(null,'','/')`(템플릿 주석) 또는 라우터에 경로 등록 |
| `postMessage: Flutter handler not available` | 위젯 래퍼가 `callHandler` 외에 `flutter_inappwebview.postMessage` 사용 | kit 이 postMessage 도 수용(fire-and-forget). 최신 kit 로 갱신. 반환값 필요한 호출은 callHandler 필수 |
| Click/Up/Down 버튼 무반응 | 캡처 컨테이너 불일치(kit 기본 `11/'cap'` vs 위젯 자체 값) | `startHarness({ capture: { containerID, containerName } })` 로 위젯 값과 일치 |
| 로컬경로 설치 후 serve.mjs 기동 실패 | `npm install <로컬경로>` 는 심링크 — 의존성(playwright-core) 미설치 | `npm install github:oneticket99/even_hub_dev_simulator`(권장) 또는 소비 프로젝트에 `npm i playwright-core` 추가(cwd 폴백이 해석) |
| 스크린샷 API 무한 대기/타임아웃 | 페이지가 렌더 불가 상태(위젯 예외 등) | serve 는 10s 명시 타임아웃 후 500+사유 반환 — `/api/console` 로 위젯 에러부터 확인 |
| smoke 가 빈 화면인데 PASS | HTTP 200 만 판정 | 위 **smoke 판정 가이드** 적용(`?stats=1` 발광 픽셀 하한 + 마커 + 역검증) |
| 시작 페이지만 발광해도 litPixels>0 통과("시작 안 된 상태" 위장) | 위젯이 폰 UI 플로우(입력·제출)를 거쳐야 실 HUD 진입 | `/api/dom` 으로 플로우를 태운 뒤 판정. 하한선을 실화면 기준으로 상향 + `/api/console` 상태 마커·`/api/dom/text` 를 함께 assert |
| 콘솔에 favicon 404 소음 | 하니스 페이지 favicon 미지정 | 템플릿에 `<link rel="icon" href="data:,">` 포함(최신 템플릿) |

## 스탠드얼론 데스크톱 뷰 (PyQt)

안경 뷰(하니스)와 폰 설정 웹뷰를 한 창에, 각각 JS 콘솔 캡처 패널과 함께 도킹:

```bash
pip install -r sim/requirements.txt
python sim/standalone_sim.py --harness http://127.0.0.1:5173/harness/ --settings http://127.0.0.1:8099/settings
```

`--settings` 는 아무 웹 UI 나 가능(설정 페이지가 없으면 생략하고 패널을 닫아도 됨).

## 와이어 캡처 (조사 도구)

`wirecapture.js` = 어떤 Even Hub WebView 표면에도 수동 주입 가능한 관측 스크립트.
`callHandler` 인자·반환과 모든 CustomEvent 를 로깅해 **문서화 안 된 브릿지 메서드/이벤트**를 실측한다.
DevTools 콘솔에 파일 내용을 붙여넣으면 즉시 동작. 원격 회수는 조작자가 `window.__WC_BACKEND` 를
명시한 경우에만(자동 채택 없음). 자세한 주의사항은 파일 헤더 주석 참조.

## 한계 (하니스가 못 하는 것)

- **펌웨어 픽셀 정합**: 폰트·줄바꿈·그레이스케일 양자화 재현 안 함 → 공식 시뮬/실기로.
- **BLE 타이밍/대역폭**: 이미지 직렬 전송 지연·과부하(타일 찢김) 재현 안 함 → 실기로.
- **실 마이크 PCM / 실 IMU 물리값**: `audioControl` 은 false 반환(no-op), IMU 는 합성 파형.
- **호스트 라이프사이클**: 백그라운드 상태 리셋·재스캔 흐름 재현 안 함.

SDK 자체의 제약(컨테이너 수·이미지 캡·이벤트 채널 등)은 [SDK.md](SDK.md) 참조.

## 요구사항

- 브라우저 하니스: Vite(또는 TS 를 서빙하는 dev 서버) — kit 의 `src/mockbridge.ts` 는 TS 소스로 제공.
- `serve.mjs`: Node ≥ 20 + `playwright-core`(kit 의존성) + **시스템 Chrome**(`channel:'chrome'`).
- `sim/`: Python 3.10+ / PyQt6 + PyQt6-WebEngine.

## 라이선스

MIT
