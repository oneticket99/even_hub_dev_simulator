/* Even Hub 와이어 캡처(EP-0009 조사도구) — 어떤 Even Hub webview 표면에도 주입 가능한 독립 스크립트.
 *
 * 목적: 터미널모드 등 "우리 위젯이 아닌" 표면의 브릿지 프로토콜을 관측 → Hub SDK 보다 풍부한
 *       메서드/이벤트(미공개 링 데이터 등)가 있는지 실측.
 *
 * 관측 대상:
 *   - Widget→Host: window.flutter_inappwebview.callHandler(name, payload) 의 인자·반환
 *   - Host→Widget: window.dispatchEvent(CustomEvent(...)) 의 evenHub/deviceStatus/location/launch 이벤트
 *
 * 기본은 **콘솔 전용**. 백엔드 원격 회수를 원할 때만 조작자가 직접 window.__WC_BACKEND 를 설정한다
 *   (임의 URL 자동 채택 금지 — data-exfil/open-redirect 방지. 붙여넣는 조작자 본인이 목적지 명시).
 *
 * ⚠ 캡처 로그에는 민감 데이터(user info·device 토큰·이미지 바이트)가 포함될 수 있다. 조사 목적의
 *   수동 dev 도구로만 사용하고, __WC_BACKEND 는 신뢰하는 자기 백엔드로만 지정할 것. 프로덕션 번들엔 포함 안 됨.
 *
 * 사용법(수동 주입만 — 프로덕션 위젯엔 자동 로드 배선 없음):
 *   (a) 표면에 DevTools 가 붙으면 이 파일 내용을 콘솔에 붙여넣기(즉시 실행). 원격 회수 원하면 먼저:
 *         window.__WC_BACKEND = 'http://<신뢰-백엔드>:8099'
 *   (b) 하니스 등 dev 페이지에서 <script src=".../wirecapture.js"> 로 포함(dev 전용, 프로덕션 아님).
 */
(function () {
  if (window.__WIRECAPTURE__) return;   // 중복 주입 방지
  window.__WIRECAPTURE__ = true;

  // 백엔드 POST 는 조작자가 명시적으로 __WC_BACKEND 를 설정한 경우에만(자동 채택/same-origin 금지).
  // http(s) 로 시작하는 문자열만 허용.
  var raw = typeof window.__WC_BACKEND === 'string' ? window.__WC_BACKEND : '';
  var backend = /^https?:\/\//.test(raw) ? raw : '';

  function emit(msg) {
    var line = 'WIRE ' + msg;
    try { console.log(line); } catch (e) {}
    if (backend) {
      try {
        fetch(backend.replace(/\/$/, '') + '/debug/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ line: line.slice(0, 400) }),
        }).catch(function () {});
      } catch (e) {}
    }
  }

  // ── Widget→Host: callHandler 래핑(늦은 주입 대비 getter/setter) ──
  function hook(fi) {
    if (!fi || !fi.callHandler || fi.__wc) return fi;
    var orig = fi.callHandler.bind(fi);
    fi.callHandler = function (name, payload) {
      emit('SEND ' + name + ' ' + String(payload).slice(0, 300));
      var r;
      try { r = orig(name, payload); } catch (e) { emit('THROW ' + name + ' ' + (e && e.message)); throw e; }
      if (r && r.then) {
        r.then(
          function (res) { emit('RECV ' + name + ' ' + safe(res)); },
          function (err) { emit('REJECT ' + name + ' ' + safe(err && err.message ? err.message : err)); }
        );
      }
      return r;
    };
    fi.__wc = true;
    emit('INFO callHandler hooked');
    return fi;
  }
  function safe(v) { try { return JSON.stringify(v).slice(0, 300); } catch (e) { return String(v).slice(0, 300); } }

  var cur = window.flutter_inappwebview;
  if (cur) hook(cur);
  try {
    Object.defineProperty(window, 'flutter_inappwebview', {
      configurable: true,
      get: function () { return cur; },
      set: function (v) { cur = hook(v); },
    });
  } catch (e) { /* 이미 정의된 non-configurable 이면 무시(위에서 hook 시도됨) */ }

  // ── Host→Widget: 모든 CustomEvent 관측(이름 필터 없이 — 미공개 이벤트명 발견 목적) ──
  var od = window.dispatchEvent.bind(window);
  window.dispatchEvent = function (ev) {
    try {
      var t = ev && ev.type ? ev.type : '';
      // 브라우저 기본 이벤트(click/keydown 등) 제외, 커스텀/브릿지성만
      if (t && !/^(click|mouse|key|pointer|touch|scroll|resize|focus|blur|load|visibilitychange|message|shadow-timer)/.test(t)) {
        emit('EVENT ' + t + ' ' + safe(ev.detail));
      }
    } catch (e) {}
    return od(ev);
  };

  emit('INFO wirecapture active — backend=' + (backend || '(none)'));
})();
