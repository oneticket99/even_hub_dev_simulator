# Even Hub SDK / Wire-Protocol Reference (for generic simulator use)

> 🇬🇧 English (this document) · 🇰🇷 [한국어](SDK.md) — Harness manual: [English](README.en.md) · [한국어](README.md)

This document collects the SDK facts you need when using the harness/simulator with **any**
Even Hub widget project. Sources: `@evenrealities/even_hub_sdk` 0.0.13 typings, official docs
(hub.evenrealities.com/docs), wire captures of the official simulator, and G2 real-device
verification (2026-08). Re-verify when the SDK version moves.

## 1. Execution model

- The widget runs in the **Flutter WebView of the phone's Even app**, not on the glasses. The glasses render firmware (LVGL) containers only.
- Data flow: `widget (HTML/TS) → EvenAppBridge (SDK) → Even app (phone) → BLE → G2 HUD`.
- Outbound network is sandboxed by the `app.json` `network` permission + **domain whitelist** (CORS is additionally enforced).
- Entering background resets WebView state → persist via `setLocalStorage`/`getLocalStorage`.

## 2. Wire protocol (what the harness reproduces)

- **Widget→Host**: `window.flutter_inappwebview.callHandler('evenAppMessage', payload)`
  - `payload` = `JSON.stringify({ type: 'call_even_app_method', method: '<name>', data: {...} })`
  - Return = Promise (per-method result). Subscription-style calls (`listen_even_app_data`, …) resolve `true`.
- **Host→Widget**: `window.dispatchEvent(new CustomEvent(<name>, { detail }))`
  - `evenHubEvent` — input/system events. `detail = { jsonData, listEvent? | textEvent? | sysEvent? | audioEvent? }`
  - `appLocationChanged` — GPS. `detail = { latitude, longitude, speed(m/s), ... }` (NOT an evenHubEvent!)
  - `deviceStatusChanged` — device status (battery/wearing). `evenAppBridgeReady` — bridge-ready signal.
- The SDK's `waitForEvenAppBridge()` assumes `window.flutter_inappwebview` exists → a mock must be installed **before** SDK init.
- **postMessage variant**: some widget wrappers send evenAppMessage via
  `window.flutter_inappwebview.postMessage(JSON)` instead of (or alongside) `callHandler`
  (fire-and-forget). The harness accepts both, but **calls that need a return value must use
  callHandler**.

## 3. Bridge methods (the 10 the official simulator supports = the harness baseline)

| method | returns | notes |
|---|---|---|
| `getUserInfo` | `{uid, name, avatar, country}` | |
| `getGlassesInfo` | `{model:'g2', sn, status:{batteryLevel, isWearing, isCharging, isInCase, connectType, sn}}` | Glasses only; no R1 ring enumeration |
| `setLocalStorage` / `getLocalStorage` | `true` / value | Persistence (survives background reset) |
| `createStartUpPageContainer` | `0=success / 1=invalid / 2=oversize / 3=oom` | **Exactly once per app.** On HMR re-runs the simulator returns 1 ("already created") — run E2E from a clean simulator restart |
| `rebuildPageContainer` | `true` | Full page redraw (heavy — BLE re-send) |
| `updateImageRawData` | `'success'` | `{containerID, imageData}`. **imageData must be raw bytes (number[]/Uint8Array)** — base64 strings are tolerated by simulators but ignored by real hardware |
| `textContainerUpgrade` | `true` | In-place update of a text container's content |
| `shutDownPageContainer` | `true` | Arg 1 = confirm dialog (required for store review), 0 = instant exit (rejection reason) |
| `audioControl` | `false` (sim) | Real hardware streams mic PCM as `audioEvent{audioPcm}` |

## 4. The 6 methods the official simulator does NOT support (harness mocks)

| method | official sim | harness |
|---|---|---|
| `getAppLocation` | ✗ unknown variant (+hang) | returns geoInput coordinates |
| `startAppLocationUpdates` / `stopAppLocationUpdates` | ✗ | `true` (no auto-feed — GPS is one-shot via button/`pushGeo`) |
| `imuControl` | ✗ | when on, emits a synthetic IMU waveform as low-rate sysEvents |
| `pickImageFromAlbum` / `captureImageFromCamera` | ✗ | fixed PNG-header byte stub |

→ Code paths depending on GPS/IMU/camera/album can be **auto-E2E'd only with the harness**.
Values are mocks — physical fidelity is real-device territory.

## 5. Input events

- Receive via `bridge.onEvenHubEvent((e) => { ... })`. The event object arrives in
  `listEvent` / `textEvent` / `sysEvent` **depending on the focused container type** →
  the correct handler is the fallthrough `e.listEvent ?? e.textEvent ?? e.sysEvent`.
- `eventType` (`OsEventTypeList`): `CLICK=0, SCROLL_TOP=1 (up/prev), SCROLL_BOTTOM=2 (down/next), DOUBLE_CLICK=3,`
  `FOREGROUND_ENTER=4, FOREGROUND_EXIT=5, ABNORMAL_EXIT=6, SYSTEM_EXIT=7`. No left/right swipe, long-press, or drag.
- R1 ring input (slide/click/double-tap) arrives on the **same event stream** via the glasses relay.
- **Events only reach the app if a container with `isEventCapture:1` holds focus, and an
  empty/borderless container cannot take focus** → the capture container needs
  `borderWidth ≥ 2` (real-device verified). Exactly one capture container per page.
- Simulator/harness automation `/api/input` vocabulary: `click / double_click / up / down`
  (`scroll_top` etc. return 400). `up`→SCROLL_TOP, `down`→SCROLL_BOTTOM.

## 6. HUD canvas & container constraints (hardware facts)

- Canvas **576×288**, 4-bit **green greyscale** (0–15). No color, no photos.
- Per page: ≤ 12 containers total, text ≤ 8, **images ≤ 4**.
- **Image container hard cap = width 20–288 / height 20–144** (a quarter of the screen).
  Full-screen graphics require 2×2 tiling → tiles are sent serially over BLE and tear on
  refresh. No partial-region (dirty-rect) update API.
- Text containers can span the full 576×288 but have **no font-size/alignment/monospace
  control** (fixed proportional font). Aligned digit columns, grids, and big type are only
  possible via **image (canvas raster) rendering**.
- List containers: ≤ 20 items × 64 chars, only a uniform `itemWidth`. Content changes require
  a page rebuild. Native scrolling is smooth but emits no app events mid-scroll (only a
  selection index on click), and the app cannot move the selection highlight.
- No transition-animation API. Frame-sequenced animation breaks on real hardware
  (BLE bandwidth 10–30KB/s).

## 7. Real device ↔ official sim ↔ harness differences (beware false positives)

| Item | Harness | Official sim | Real G2 |
|---|---|---|---|
| Pixel fidelity | approximate (different fonts) | baseline | final |
| `updateImageRawData` base64 string | tolerated | tolerated | **ignored (bytes required)** |
| create re-call (HMR) | harmless (resets) | returns `1` persistently | clean per app launch |
| GPS/IMU/camera/album | mockable | unavailable | real values |
| BLE latency / tile tearing | not reproduced | not reproduced | occurs |
| Microphone PCM | none | none (accepts only) | real stream |
| Battery & device values | injectable option | fixed 100 | real values |

Lesson: green in sim/harness does not settle anything in the right column — only real
hardware does.

## 8. Unexposed surfaces (what widgets cannot do — workarounds required)

- **Heart rate / R1 ring health** (HR, SpO₂, HRV, temperature, steps): not exposed by the SDK.
  `getGlassesInfo` returns glasses only; the ring is not enumerated.
- **iOS system notifications**: no event type (ANCS feeds the firmware/native dashboard only).
- `onDeviceStatusChanged` may fire garbage events like `{sn:"", batteryLevel:0}` when the ring
  is docked/undocked → guard against them.
- To probe for undocumented methods/events, use `wirecapture.js` (as of 2026-08, no extra
  surface was found — including terminal mode).

## 9. app.json permissions (widget manifest)

`network` (+whitelist; one origin each, no wildcards, HTTPS for production), `location`,
`g2-microphone`, `phone-microphone`, `album`, `camera`. Declaring unused permissions is a
store-rejection reason. Remove any dev LAN `http://…` whitelist entries before commit/release.

## 10. CLI / official simulator reference

```bash
evenhub login -e <email>                     # account auth (needed for official sim & device QR; NOT for the harness)
evenhub qr --url http://<LAN-IP>:5173        # QR for loading on real hardware
evenhub pack app.json dist -o app.ehpk       # packaging for distribution
evenhub-simulator http://localhost:5173 --automation-port 9898   # official sim + automation
```

The official simulator's automation API shares the contract of the harness `serve.mjs`
(see [README.en.md](README.en.md)) — reuse one E2E runner against both.
