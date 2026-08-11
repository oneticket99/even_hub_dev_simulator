#!/usr/bin/env python3

"""Even G2 스탠드얼론 시뮬레이터 (PyQt6 + QtWebEngine) — 도킹 레이아웃.

4개 **도킹 패널**(각각 뗐다 붙였다/플로팅/닫기 가능):
  - 안경 뷰 = Dev 하니스(/harness/, mock 브릿지 + 글래스 렌더)
  - 안경 콘솔 = 안경 뷰 JS console.log/warn/err 캡처
  - 앱 설정 뷰 = /settings (폰 앱 UI 웹뷰)
  - 앱 설정 콘솔 = 설정 뷰 JS 콘솔 캡처
경계가 보이도록 타이틀바·테두리·대비 적용. 각 뷰에 새로고침/DevTools 버튼.

사용:
  python standalone_sim.py \\
    --harness http://127.0.0.1:5173/harness/ --settings http://127.0.0.1:8099/settings
전제: Vite dev(:5173) + 백엔드(:8099) 기동. PyQt6·PyQt6-WebEngine 필요(sim/requirements.txt).
"""
from __future__ import annotations

import argparse
import base64
import sys

from PyQt6.QtCore import QUrl, Qt
from PyQt6.QtWebEngineCore import QWebEnginePage
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWidgets import (
    QApplication, QDockWidget, QFileDialog, QHBoxLayout, QMainWindow, QPlainTextEdit,
    QPushButton, QVBoxLayout, QWidget,
)

_LVL = {0: "LOG", 1: "WARN", 2: "ERR"}

# UI 언어 사전 (--lang ko|en)
I18N = {
    "ko": {
        "glasses_view": "안경 뷰 (Dev 하니스)", "settings_view": "앱 설정 뷰 (WebView)",
        "glasses_console": "안경 콘솔", "settings_console": "앱 설정 콘솔",
        "reload": "↻ 새로고침", "devtools": "DevTools", "title": "Even G2 Standalone Simulator", "back": "← 뒤로", "shot": "📸 스크린샷",
    },
    "en": {
        "glasses_view": "Glasses View (Dev Harness)", "settings_view": "App Settings View (WebView)",
        "glasses_console": "Glasses Console", "settings_console": "Settings Console",
        "reload": "↻ Reload", "devtools": "DevTools", "title": "Even G2 Standalone Simulator", "back": "← Back", "shot": "📸 Screenshot",
    },
}

QSS = """
QMainWindow { background: #16211b; }
QMainWindow::separator { background: #2c4638; width: 4px; height: 4px; }
QDockWidget {
  color: #cfe; titlebar-close-icon: none; titlebar-normal-icon: none;
  border: 1px solid #2c4638;
}
QDockWidget::title {
  background: #1c2b22; color: #39ff88; padding: 6px 10px;
  border-bottom: 1px solid #2c4638; font-weight: bold;
}
QDockWidget > QWidget { border: 1px solid #2c4638; }
QPlainTextEdit {
  background: #0d1512; color: #9ab; border: 1px solid #2c4638;
  font-family: 'SF Mono', Menlo, monospace; font-size: 11px;
}
QPushButton {
  background: #16241d; color: #cfe; border: 1px solid #2c4638;
  border-radius: 5px; padding: 4px 10px;
}
QPushButton:hover { background: #1e3529; }
QWidget#viewwrap { background: #0b0f0d; }
"""


class LoggingPage(QWebEnginePage):
    """JS 콘솔 메시지를 지정 로그 위젯으로 캡처. 'harness-lang <ko|en>' 마커로 호스트 UI 언어 동기."""

    def __init__(self, log: QPlainTextEdit, parent=None, lang_cb=None) -> None:
        super().__init__(parent)
        self._log = log
        self._lang_cb = lang_cb
        # 마이크 등 미디어 권한 자동 허용(STT 하니스 테스트 — 시스템 마이크로 발화 인식)
        self.featurePermissionRequested.connect(self._grant_permission)

    def _grant_permission(self, origin, feature):  # noqa: ANN001
        self.setFeaturePermission(origin, feature, QWebEnginePage.PermissionPolicy.PermissionGrantedByUser)

    def javaScriptConsoleMessage(self, level, message, line, source):  # noqa: N802
        if self._lang_cb and isinstance(message, str) and message.startswith("harness-lang "):
            lang = message.split(" ", 1)[1].strip()
            if lang in I18N:
                self._lang_cb(lang)
        lv = level.value if hasattr(level, "value") else int(level)
        src = (source or "").rsplit("/", 1)[-1]
        self._log.appendPlainText(f"[{_LVL.get(lv, '?')}] {message}  ({src}:{line})")
        sb = self._log.verticalScrollBar()
        sb.setValue(sb.maximum())


def _dock(win: QMainWindow, title: str, widget: QWidget, area) -> QDockWidget:
    d = QDockWidget(title, win)
    d.setObjectName(title)
    d.setFeatures(
        QDockWidget.DockWidgetFeature.DockWidgetMovable
        | QDockWidget.DockWidgetFeature.DockWidgetFloatable
        | QDockWidget.DockWidgetFeature.DockWidgetClosable
    )
    d.setWidget(widget)
    win.addDockWidget(area, d)
    return d


def _view_panel(url: str, log: QPlainTextEdit, tr: dict, lang_cb=None):
    """웹뷰 + 상단 버튼바(새로고침/DevTools) 패널. 콘솔 캡처는 log 로.
    반환: (wrap, reload_btn, dev_btn) — 언어 동기 시 라벨 갱신용."""
    wrap = QWidget()
    wrap.setObjectName("viewwrap")
    v = QVBoxLayout(wrap)
    v.setContentsMargins(6, 6, 6, 6)
    v.setSpacing(6)

    bar = QHBoxLayout()
    bar.setSpacing(6)
    back_btn = QPushButton(tr.get("back", "← Back"))
    reload_btn = QPushButton(tr["reload"])
    dev_btn = QPushButton(tr["devtools"])
    shot_btn = QPushButton(tr.get("shot", "📸 스크린샷"))
    bar.addWidget(back_btn)
    bar.addWidget(reload_btn)
    bar.addWidget(dev_btn)
    bar.addWidget(shot_btn)
    bar.addStretch(1)
    v.addLayout(bar)

    view = QWebEngineView()
    page = LoggingPage(log, view, lang_cb=lang_cb)
    view.setPage(page)
    view.setUrl(QUrl(url))
    v.addWidget(view, 1)
    back_btn.clicked.connect(view.back)   # 웹뷰 뒤로가기(구글 로그인 등에서 복귀)

    dev_view = QWebEngineView()
    dev_view.setWindowTitle("DevTools")
    page.setDevToolsPage(dev_view.page())

    def toggle() -> None:
        dev_view.resize(950, 640)
        dev_view.show()
        dev_view.raise_()

    # 안경 디스플레이(#glass 캔버스) → 576×288 PNG 저장(포털 스크린샷 규격). 없으면(설정 뷰) 무시.
    def save_shot(data_url: object) -> None:
        s = str(data_url or "")
        if not s.startswith("data:image/png;base64,"):
            return
        png = base64.b64decode(s.split(",", 1)[1])
        path, _ = QFileDialog.getSaveFileName(wrap, "안경 스크린샷 저장", "glasses-576x288.png", "PNG (*.png)")
        if path:
            with open(path, "wb") as f:
                f.write(png)

    def shot() -> None:
        # #glass 캔버스 → 포털 합성용 RGBA. 색 정규화(밝은 초록) + 90% 상한 알파(AR 반투명감).
        js = (
            "(function(){var c=document.querySelector('#glass');if(!c)return '';"
            "var o=document.createElement('canvas');o.width=c.width;o.height=c.height;"
            "var x=o.getContext('2d');x.drawImage(c,0,0);"
            "var m=x.getImageData(0,0,o.width,o.height),d=m.data,i,v,s;"
            "for(i=0;i<d.length;i+=4){v=Math.max(d[i],d[i+1],d[i+2]);"
            "if(v===0){d[i+3]=0;continue;}s=255/v;"
            "d[i]*=s;d[i+1]*=s;d[i+2]*=s;"
            "d[i+3]=Math.min(230,Math.round(230*Math.pow(v/255,0.6)));}"
            "x.putImageData(m,0,0);return o.toDataURL('image/png');})()"
        )
        page.runJavaScript(js, save_shot)

    reload_btn.clicked.connect(view.reload)
    dev_btn.clicked.connect(toggle)
    shot_btn.clicked.connect(shot)
    return wrap, reload_btn, dev_btn


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--harness", default="http://127.0.0.1:5173/harness/")
    ap.add_argument("--settings", default="http://127.0.0.1:8099/settings")
    ap.add_argument("--lang", choices=["ko", "en"], default="ko",
                    help="UI language for dock titles/buttons (ko|en)")
    args = ap.parse_args()
    tr = I18N[args.lang]

    app = QApplication(sys.argv)
    app.setStyleSheet(QSS)
    win = QMainWindow()
    win.setWindowTitle(tr["title"])
    win.setDockNestingEnabled(True)
    win.resize(1360, 820)

    L = Qt.DockWidgetArea.LeftDockWidgetArea
    R = Qt.DockWidgetArea.RightDockWidgetArea

    g_log = QPlainTextEdit(); g_log.setReadOnly(True); g_log.setMaximumBlockCount(300)  # 메모리 관리: 300줄 초과 시 과거 자동삭제
    s_log = QPlainTextEdit(); s_log.setReadOnly(True); s_log.setMaximumBlockCount(300)  # 메모리 관리: 300줄 초과 시 과거 자동삭제

    # 하니스 웹 토글(#langToggle)의 'harness-lang' 콘솔 마커로 PyQt UI 언어를 실시간 동기.
    btns: list = []

    def retitle(lang: str) -> None:
        d = I18N[lang]
        win.setWindowTitle(d["title"])
        g_view.setWindowTitle(d["glasses_view"]); s_view.setWindowTitle(d["settings_view"])
        g_console.setWindowTitle(d["glasses_console"]); s_console.setWindowTitle(d["settings_console"])
        for rb, db in btns:
            rb.setText(d["reload"]); db.setText(d["devtools"])

    g_panel, g_rb, g_db = _view_panel(args.harness, g_log, tr, lang_cb=retitle)
    s_panel, s_rb, s_db = _view_panel(args.settings, s_log, tr)
    btns.extend([(g_rb, g_db), (s_rb, s_db)])
    g_view = _dock(win, tr["glasses_view"], g_panel, L)
    s_view = _dock(win, tr["settings_view"], s_panel, R)
    g_console = _dock(win, tr["glasses_console"], g_log, L)
    s_console = _dock(win, tr["settings_console"], s_log, R)

    # 뷰 아래에 콘솔 배치(세로 분할)
    win.splitDockWidget(g_view, g_console, Qt.Orientation.Vertical)
    win.splitDockWidget(s_view, s_console, Qt.Orientation.Vertical)
    win.resizeDocks([g_console, s_console], [220, 220], Qt.Orientation.Vertical)

    win.show()
    return app.exec()


if __name__ == "__main__":
    raise SystemExit(main())
