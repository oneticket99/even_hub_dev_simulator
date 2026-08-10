# Even Hub SDK / 와이어 프로토콜 레퍼런스 (시뮬레이터 범용 사용 참고)

> 🇰🇷 한국어(현재 문서) · 🇬🇧 [English](SDK.en.md) — 하니스 설명서: [한국어](README.md) · [English](README.en.md)

이 문서는 하니스/시뮬레이터를 **아무 Even Hub 위젯 프로젝트**에서 쓸 때 필요한 SDK 사실을 정리한다.
근거: `@evenrealities/even_hub_sdk` 0.0.13 타입·공식 docs(hub.evenrealities.com/docs)·공식 시뮬 와이어 캡처·
G2 실기 검증(2026-08). 버전이 오르면 재확인할 것.

## 1. 실행 모델

- 위젯은 글래스가 아니라 **폰 Even 앱의 Flutter WebView** 에서 실행된다. 글래스는 펌웨어(LVGL 컨테이너)만 렌더.
- 데이터 흐름: `위젯(HTML/TS) → EvenAppBridge(SDK) → Even 앱(폰) → BLE → G2 HUD`.
- 아웃바운드 네트워크는 `app.json` 의 `network` 권한 + **도메인 whitelist** 로 샌드박스(CORS 도 별도로 강제).
- 백그라운드 진입 시 WebView 상태 리셋 → 영속은 `setLocalStorage`/`getLocalStorage` 로.

## 2. 와이어 프로토콜 (하니스가 재현하는 것)

- **Widget→Host**: `window.flutter_inappwebview.callHandler('evenAppMessage', payload)`
  - `payload` = `JSON.stringify({ type: 'call_even_app_method', method: '<이름>', data: {...} })`
  - 반환 = Promise(메서드별 결과). 구독성 호출(`listen_even_app_data` 등)은 `true`.
- **Host→Widget**: `window.dispatchEvent(new CustomEvent(<이벤트명>, { detail }))`
  - `evenHubEvent` — 입력/시스템 이벤트. `detail = { jsonData, listEvent? | textEvent? | sysEvent? | audioEvent? }`
  - `appLocationChanged` — GPS. `detail = { latitude, longitude, speed(m/s), ... }` (evenHubEvent 아님!)
  - `deviceStatusChanged` — 기기 상태(배터리/착용). `evenAppBridgeReady` — 브릿지 준비 신호.
- SDK `waitForEvenAppBridge()` 는 `window.flutter_inappwebview` 존재를 전제 → mock 은 **SDK init 전에** 심어야 한다.
- **postMessage 변형**: 일부 위젯 래퍼는 `callHandler` 대신(또는 병행)
  `window.flutter_inappwebview.postMessage(JSON)` 로 evenAppMessage 를 보낸다(fire-and-forget).
  하니스는 둘 다 수용하되, **반환값이 필요한 호출은 callHandler 로만** 가능하다.

## 3. 브릿지 메서드 (공식 시뮬 지원 10종 = 하니스 구현 베이스)

| method | 반환 | 비고 |
|---|---|---|
| `getUserInfo` | `{uid, name, avatar, country}` | |
| `getGlassesInfo` | `{model:'g2', sn, status:{batteryLevel, isWearing, isCharging, isInCase, connectType, sn}}` | 안경 1대만. R1 링 열거 없음 |
| `setLocalStorage` / `getLocalStorage` | `true` / 값 | 영속 저장(백그라운드 리셋 대비) |
| `createStartUpPageContainer` | `0=success / 1=invalid / 2=oversize / 3=oom` | **앱당 정확히 1회.** HMR 재실행 시 시뮬이 1(이미 생성)을 돌려주는 아티팩트 있음 → E2E 는 클린 재시작 후 |
| `rebuildPageContainer` | `true` | 페이지 전체 redraw(무거움 — BLE 재전송) |
| `updateImageRawData` | `'success'` | `{containerID, imageData}`. **imageData 는 raw 바이트(number[]/Uint8Array)** — base64 문자열은 시뮬만 관대하고 실기는 무시 |
| `textContainerUpgrade` | `true` | 텍스트 컨테이너 content in-place 갱신 |
| `shutDownPageContainer` | `true` | 인자 1=확인 다이얼로그(스토어 심사 필수), 0=즉시 종료(리젝 사유) |
| `audioControl` | `false`(시뮬) | 실기는 마이크 PCM 을 `audioEvent{audioPcm}` 로 스트림 |

## 4. 공식 시뮬 **미지원** 6종 (하니스가 mock 으로 메꾸는 것)

| method | 공식 시뮬 | 하니스 |
|---|---|---|
| `getAppLocation` | ✗ unknown variant(+hang) | geoInput 좌표 반환 |
| `startAppLocationUpdates` / `stopAppLocationUpdates` | ✗ | `true`(자동주입 없음 — GPS 는 1회성 주입 버튼/`pushGeo`) |
| `imuControl` | ✗ | on 시 합성 IMU 파형을 sysEvent 로 저빈도 방출 |
| `pickImageFromAlbum` / `captureImageFromCamera` | ✗ | 고정 PNG 헤더 바이트 스텁 |

→ GPS/IMU/카메라/앨범 의존 코드경로는 **하니스로만 자동 E2E 가능**. 단 값은 mock — 물리 정합은 실기.

## 5. 입력 이벤트

- 수신: `bridge.onEvenHubEvent((e) => { ... })`. 이벤트 객체는 **포커스 컨테이너 종류에 따라**
  `listEvent` / `textEvent` / `sysEvent` 중 하나에 실린다 → `e.listEvent ?? e.textEvent ?? e.sysEvent` 폴스루가 정답.
- `eventType` (`OsEventTypeList`): `CLICK=0, SCROLL_TOP=1(위/이전), SCROLL_BOTTOM=2(아래/다음), DOUBLE_CLICK=3,`
  `FOREGROUND_ENTER=4, FOREGROUND_EXIT=5, ABNORMAL_EXIT=6, SYSTEM_EXIT=7`. 좌우 스와이프·롱프레스·드래그 없음.
- R1 링 입력(슬라이드/클릭/더블탭)은 글래스 릴레이로 **같은 이벤트 스트림**에 도착(소스 태그로 구분 가능).
- **이벤트가 도달하려면 `isEventCapture:1` 컨테이너가 포커스를 가져야 하고, 빈/무테두리 컨테이너는
  포커스를 못 받는다** → 캡처 컨테이너에 `borderWidth ≥ 2` 필수(실기 검증). 페이지당 캡처는 정확히 1개.
- 시뮬/하니스 automation `/api/input` 어휘: `click / double_click / up / down` (`scroll_top` 등은 400).
  `up`→SCROLL_TOP, `down`→SCROLL_BOTTOM 매핑.

## 6. HUD 캔버스·컨테이너 제약 (하드웨어 사실)

- 캔버스 **576×288**, 4-bit **그린 그레이스케일**(0–15). 컬러·이미지 사진 불가.
- 페이지당 컨테이너 ≤ 12: 텍스트 ≤ 8, **이미지 ≤ 4**.
- **이미지 컨테이너 하드캡 = 폭 20–288 / 높이 20–144** (화면의 1/4). 전체화면 그래픽은 2×2 타일 필수
  → 타일은 BLE 로 순차 전송돼 갱신 시 찢김(tear). 부분영역(dirty-rect) 갱신 API 없음.
- 텍스트 컨테이너는 576×288 전체 가능하나 **폰트 크기/정렬/고정폭 제어 없음**(비례폭 고정 폰트).
  숫자 열 정렬·그리드·큰 글씨는 **이미지(캔버스 래스터) 렌더가 유일 해법**.
- List 컨테이너: 항목 ≤ 20 × 각 64자, `itemWidth` 균일폭만. 내용 변경은 페이지 rebuild 필요.
  네이티브 스크롤은 부드러우나 스크롤 중 앱 이벤트 없음(클릭 시만 인덱스 전달), 선택 하이라이트는 앱이 못 움직임.
- 전환 애니메이션 API 없음. BLE 대역폭(10–30KB/s)상 프레임 시퀀싱 애니메이션은 실기에서 과부하로 파손.

## 7. 실기 ↔ 시뮬 ↔ 하니스 차이 (거짓양성 주의)

| 항목 | 하니스 | 공식 시뮬 | 실기 G2 |
|---|---|---|---|
| 렌더 픽셀 정합 | 근사(폰트 다름) | 기준선 | 최종 |
| `updateImageRawData` base64 문자열 | 허용(관대) | 허용(관대) | **무시(바이트 필수)** |
| create 재호출(HMR) | 무해(리셋) | `1` 반환 유지 | 앱 재실행마다 클린 |
| GPS/IMU/카메라/앨범 | mock 가능 | 불가 | 실값 |
| BLE 지연/타일 찢김 | 재현 안 함 | 재현 안 함 | 발생 |
| 마이크 PCM | 없음 | 없음(accept 만) | 실 스트림 |
| 배터리 등 기기값 | 옵션 주입 | 고정 100 | 실값 |

교훈: 시뮬/하니스에서 green 이어도 위 우측 열 항목은 실기로만 확정된다.

## 8. 미노출 표면 (위젯이 못 하는 것 — 우회 필요)

- **심박/R1 링 헬스**(HR·SpO₂·HRV·체온·걸음): SDK 미노출. `getGlassesInfo` 는 안경만, 링은 열거 안 됨.
- **iOS 시스템 알림**: 이벤트 타입 없음(ANCS 는 펌웨어/네이티브 대시보드 전용).
- `onDeviceStatusChanged` 는 링 착탈 시 `{sn:"", batteryLevel:0}` 쓰레기 이벤트를 쏠 수 있음 → 가드 필요.
- 미공개 메서드/이벤트 탐사는 `wirecapture.js` 로 실측(2026-08 기준 터미널모드 포함 추가 표면 없음 확인).

## 9. app.json 권한 (위젯 매니페스트)

`network`(+whitelist, origin 당 1개·와일드카드 불가·프로덕션 HTTPS), `location`, `g2-microphone`,
`phone-microphone`, `album`, `camera`. 미사용 권한 선언은 스토어 리젝 사유.
개발 중 LAN IP(`http://…`) whitelist 는 커밋/배포 전 제거.

## 10. CLI / 공식 시뮬 참고

```bash
evenhub login -e <email>                     # 계정 인증(공식 시뮬·실기 QR 에 필요. 하니스는 불필요)
evenhub qr --url http://<LAN-IP>:5173        # 실기 로드용 QR
evenhub pack app.json dist -o app.ehpk       # 배포 패키징
evenhub-simulator http://localhost:5173 --automation-port 9898   # 공식 시뮬 + automation
```

공식 시뮬 automation API 는 하니스 `serve.mjs` 와 동일 계약([README](README.md) 참조) — E2E 러너를 양쪽에 재사용할 것.
