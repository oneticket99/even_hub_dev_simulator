# evenhub-dev-harness — Universal Dev Simulator for Even Hub Widgets

> 🇬🇧 English (this document) · 🇰🇷 [한국어](README.md) — SDK reference: [English](SDK.en.md) · [한국어](SDK.md)

A development harness that runs an Even Realities **Even Hub widget** (G2 smart-glasses app)
**unmodified in a regular browser**. It fills the gaps the official `evenhub-simulator`
(native, closed) cannot cover:

- **Input mocks**: GPS, IMU, camera, album (the 6 features the official simulator does not support — see the capability matrix in [SDK.en.md](SDK.en.md))
- **Split UI**: glasses canvas (576×288) / live bridge log / input panel (click, slide, double-tap, GPS)
- **DevTools**: it is a web page, so F12 just works
- **Automation API**: same `/api/*` contract as the official simulator → reuse your existing E2E runner unmodified
- **No `evenhub login` required**: runs locally without an account or portal (CI-friendly)

Canonical repository: `oneticket99/even_hub_dev_simulator`

## Boundary (important)

The harness renderer is **not a pixel-accurate reproduction of the firmware** (it is an
approximation). Its purpose is **logic / input / interaction E2E**. Final confirmation of text
width, fonts, and pixel fidelity belongs to the official simulator and real hardware
(trusting only the harness risks `sim green / device red` false positives).

## Layout

```
harness-kit/
  src/mockbridge.ts        # Core: mock EvenAppBridge + canvas renderer + input mocks. startHarness(options)
  serve.mjs                # Headless-Chrome automation server (official-simulator API parity)
  template/index.html      # Harness page template (copy into your project)
  template/harness-main.ts # Bootstrap template (only widgetEntry needs changing)
  sim/standalone_sim.py    # PyQt6 desktop view (glasses view + settings view + console docks)
  sim/requirements.txt     # PyQt6 dependencies
  wirecapture.js           # Bridge wire-protocol observer (research tool, standalone)
  SDK.md / SDK.en.md       # Even Hub SDK / wire-protocol reference (for generic simulator use)
```

## Built-in logging & debugging tools

The harness ships with the **log and debug tooling you need for widget development**:

- **Live bridge log panel**: streams every Widget↔Host exchange, color-coded by direction and
  kind (`SEND` bridge calls / `RECV` host responses / `EVENT` injected events / `INFO`).
  **Chrome-console-style filtering** built in — substring text filter (`#logFilter`) plus
  per-kind toggles (SEND/RECV/EVENT/INFO buttons).
- **console.log mirror**: mirrors the widget's `console.log` output into the log panel —
  solves the "can't open the phone WebView console" problem in the browser.
- **F12 DevTools**: the harness is a web page, so Chrome DevTools (breakpoints, network,
  console) work out of the box.
- **Remote log-polling API**: `GET /api/console[?since_id]` — machine-readable console logs
  for headless E2E and CI (marker assertions).
- **Wire-protocol capture**: inject `wirecapture.js` into any Even Hub WebView surface to
  record full bridge calls and events (for investigating undocumented APIs).
- **PyQt standalone view**: glasses view and settings view each get a JS console capture
  panel plus a DevTools button.

## How it works

An Even Hub widget runs inside the Flutter WebView of the phone's Even app and talks to the
host over this channel:

- Widget→Host: `window.flutter_inappwebview.callHandler('evenAppMessage', JSON({type,method,data}))` → Promise(result)
- Host→Widget: `window.dispatchEvent(new CustomEvent('evenHubEvent', {detail}))`, `appLocationChanged`, etc.

`mockbridge.ts` installs a mock of this bridge **before** SDK initialization and then
dynamically imports the widget entry. From the widget's point of view it is indistinguishable
from a real host → **zero widget changes**. PNG bytes passed to `updateImageRawData` are
blitted onto the canvas; text/list containers are approximated with border + content.

## Quick integration (new project, 5 steps)

Prerequisite: a Vite-based Even Hub widget project (the official `evenhub init` layout:
`index.html` + `src/main.ts`).

1. **Install the kit** — one of:
   ```bash
   npm install github:oneticket99/even_hub_dev_simulator   # git dependency
   npm install /path/to/harness-kit                        # local path
   # or copy the kit directory into your repo (relative import)
   ```
2. **Create the harness page**: copy `template/index.html` + `template/harness-main.ts`
   into a `harness/` directory under your widget root.
3. **Edit the bootstrap**: point `widgetEntry` in `harness/harness-main.ts` at your entry:
   ```ts
   import { startHarness } from 'evenhub-dev-harness'   // when copied: '../relative/path/src/mockbridge'
   await startHarness({ widgetEntry: () => import('/src/main.ts') })
   ```
   If your widget's event-capture container (`isEventCapture:1`) is not id 11 / name 'cap',
   match it via the `capture: { containerID, containerName }` option (otherwise the
   Click/Up/Down buttons will appear dead).
4. **Visual development**: run `npm run dev` and open `http://localhost:5173/harness/`.
   Buttons map to ring gestures (Up/Down = slide, Click = tap, Double = double-tap);
   GPS injection is one-shot.
5. **Automated E2E** (system Chrome required):
   ```bash
   node node_modules/evenhub-dev-harness/serve.mjs --widget http://127.0.0.1:5173/harness/ --port 9899
   curl http://127.0.0.1:9899/api/ping        # → pong
   ```
   If you already have an E2E runner written against the official simulator's automation
   API, run it as-is with `--base http://127.0.0.1:9899`.

## startHarness option reference

| Option | Default | Description |
|---|---|---|
| `widgetEntry` | (required) | Widget entry loader, called after the mock bridge is installed. `() => import('/src/main.ts')` |
| `glass` | `'#glass'` | Glasses canvas (576×288). Selector or element |
| `log` | `'#log'` | Log panel. `null` disables the log UI |
| `geoInput` | `'#geo'` | GPS coordinate input field (`"lat,lon"`) |
| `buttons` | `#bClick/#bUp/#bDown/#bDouble/#bGeo` | Input button selector map (only existing ones are wired) |
| `capture` | `{containerID:11, containerName:'cap'}` | Capture container for textEvent. **Must match the widget** |
| `glassesInfo` | g2/HARNESS-0001/88% | Override for the `getGlassesInfo` response |
| `userInfo` | uid 'harness' | Override for the `getUserInfo` response |
| `defaultGeo` | `[37.5665,126.978]` | Coordinates used when geoInput is absent/unparsable |
| `appId` | `'harness'` | `window.__EVEN_HUB_APP_ID__` |
| `mirrorConsole` | `true` | Mirror `console.log` into the log panel |
| `storagePrefix` | `'h_'` | Key prefix for set/getLocalStorage |
| `onUnknownMethod` | — | Hook for unimplemented bridge methods (experimenting with new SDK methods) |

Returned `HarnessApi`: `fireEvent(detail)` / `textEvent(type)` / `sysEvent(type)` /
`pushGeo(lat?,lon?)` / `redraw()` — for injecting input from scripts without buttons.

## Automation API (serve.mjs)

Same contract as the official `evenhub-simulator --automation-port`:

| Path | Behavior |
|---|---|
| `GET /api/ping` | `"pong"` |
| `GET /api/console[?since_id=N]` | `{entries:[{id,level,message,ts}]}` — page console/error buffer (1000) |
| `GET /api/screenshot/glasses` | Glasses canvas PNG (`--glass` selector, default `#glass`). `?stats=1` → `{litPixels,…}` JSON |
| `GET /api/screenshot/webview` | Full-page PNG (including phone-side UI) |
| `POST /api/input {"action":...}` | `click` \| `up` \| `down` \| `double_click` \| `gps` (harness-only) |
| `POST /api/dom {selector, action, value?}` | Drive phone-side DOM: `click`/`fill`/`submit`. evaluate-based — works on hidden `#app` elements too |
| `GET /api/dom/text?selector=` | `{exists, visible, text, value}` — for asserting phone-UI state |

**Automating phone-UI flows**: if the widget requires phone-side DOM interaction (e.g. type a
destination → submit → pick a candidate), ring inputs alone cannot drive the flow → inject
input/clicks from your script via `/api/dom`:

```bash
curl -X POST :9899/api/dom -d '{"selector":"#dest-input","action":"fill","value":"Seoul Station"}'
curl -X POST :9899/api/dom -d '{"selector":"#dest-input","action":"submit"}'
curl -X POST :9899/api/dom -d '{"selector":".candidate:first-child","action":"click"}'
curl ":9899/api/dom/text?selector=.route-status"   # assert state
```

Flags: `--widget <harness URL>` `--port <port>` `--glass <canvas selector>`.

**Smoke-judging guide (important)**: an empty canvas still returns HTTP 200 with a valid PNG —
**judging on 200 is a false positive**. Always judge by:
1. `GET /api/screenshot/glasses?stats=1` → `{litPixels, totalPixels}` with a **lit-pixel floor**
   (e.g. `litPixels > 500`),
2. asserting a widget `ready`/state **marker string** via `/api/console`,
3. ideally a **negative check** too (the smoke must FAIL under a deliberate break, e.g.
   removing the widget's mount element).

## Troubleshooting (measured while integrating real projects)

| Symptom | Cause | Fix |
|---|---|---|
| Widget silently does nothing (zero bridge calls) | Widget requires a phone-side mount root (`#app`, …) missing from the harness page | Keep/add the template's hidden `<div id="app">`; match the id your widget uses |
| SPA router not-found → widget never mounts | Router doesn't know the `/harness/` path | Uncomment `history.replaceState(null,'','/')` in the bootstrap template, or register the route |
| `postMessage: Flutter handler not available` | Widget wrapper uses `flutter_inappwebview.postMessage` besides `callHandler` | The kit accepts postMessage too (fire-and-forget). Update to the latest kit. Calls needing a return value must use callHandler |
| Click/Up/Down buttons do nothing | Capture-container mismatch (kit default `11/'cap'` vs your widget's values) | Match via `startHarness({ capture: { containerID, containerName } })` |
| serve.mjs fails to start after a local-path install | `npm install <local path>` symlinks and skips deps (playwright-core missing) | Prefer `npm install github:oneticket99/even_hub_dev_simulator`, or add `npm i playwright-core` in the consumer (the cwd fallback resolves it) |
| Screenshot API hangs / times out | Page in a non-renderable state (widget exception, …) | serve fails fast after an explicit 10s timeout with a 500+reason — check `/api/console` for widget errors first |
| Smoke passes on a blank screen | Judging on HTTP 200 only | Apply the **smoke-judging guide** above (`?stats=1` lit-pixel floor + markers + negative check) |
| litPixels>0 passes on the start page alone (a "not-started" state in disguise) | Widget needs a phone-UI flow (input/submit) before real HUD content appears | Drive the flow via `/api/dom` first, then judge. Raise the floor to real-screen levels and also assert `/api/console` state markers + `/api/dom/text` |
| Repeated favicon 404 in the console | Harness page has no favicon | Template now includes `<link rel="icon" href="data:,">` |

## Standalone desktop view (PyQt)

Docks the glasses view (harness) and your phone settings web UI in one window, each with a
JS console capture panel:

```bash
pip install -r sim/requirements.txt
python sim/standalone_sim.py --harness http://127.0.0.1:5173/harness/ --settings http://127.0.0.1:8099/settings
```

`--settings` can be any web UI (close the panel if you don't have one).

## Wire capture (research tool)

`wirecapture.js` is an observer script you can manually inject into any Even Hub WebView
surface. It logs `callHandler` arguments/returns and every CustomEvent, to measure
**undocumented bridge methods/events**. Paste the file's contents into a DevTools console to
activate. Remote log collection happens only when the operator explicitly sets
`window.__WC_BACKEND` (never auto-selected). See the file header for precautions.

## Limitations (what the harness does not do)

- **Firmware pixel fidelity**: fonts, line-breaking, and greyscale quantization are not
  reproduced → use the official simulator / real hardware.
- **BLE timing/bandwidth**: serial image-transfer latency and overload (tile tearing) are not
  reproduced → real hardware only.
- **Real microphone PCM / real IMU physics**: `audioControl` returns false (no-op); IMU is a
  synthetic waveform.
- **Host lifecycle**: background state reset and QR re-scan flows are not reproduced.

For constraints of the SDK itself (container counts, image caps, event channels, …) see
[SDK.en.md](SDK.en.md).

## Requirements

- Browser harness: Vite (or any dev server that serves TS) — the kit ships `src/mockbridge.ts` as TS source.
- `serve.mjs`: Node ≥ 20 + `playwright-core` (kit dependency) + **system Chrome** (`channel:'chrome'`).
- `sim/`: Python 3.10+ with PyQt6 + PyQt6-WebEngine.

## License

MIT
