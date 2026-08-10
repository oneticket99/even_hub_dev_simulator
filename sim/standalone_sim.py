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
import sys

from PyQt6.QtCore import QUrl, Qt
from PyQt6.QtWebEngineCore import QWebEnginePage
from PyQt6.QtWebEngineWidgets import QWebEngineView
from PyQt6.QtWidgets import (
    QApplication, QDockWidget, QHBoxLayout, QMainWindow, QPlainTextEdit,
    QPushButton, QVBoxLayout, QWidget,
)

_LVL = {0: "LOG", 1: "WARN", 2: "ERR"}

# UI 언어 사전 (--lang ko|en)
I18N = {
    "ko": {
        "glasses_view": "안경 뷰 (Dev 하니스)", "settings_view": "앱 설정 뷰 (WebView)",
        "glasses_console": "안경 콘솔", "settings_console": "앱 설정 콘솔",
        "reload": "↻ 새로고침", "devtools": "DevTools", "title": "Even G2 Standalone Simulator",
    },
    "en": {
        "glasses_view": "Glasses View (Dev Harness)", "settings_view": "App Settings View (WebView)",
        "glasses_console": "Glasses Console", "settings_console": "Settings Console",
        "reload": "↻ Reload", "devtools": "DevTools", "title": "Even G2 Standalone Simulator",
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
    """JS 콘솔 메시지를 지정 로그 위젯으로 캡처."""

    def __init__(self, log: QPlainTextEdit, parent=None) -> None:
        super().__init__(parent)
        self._log = log

    def javaScriptConsoleMessage(self, level, message, line, source):  # noqa: N802
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


def _view_panel(url: str, log: QPlainTextEdit, tr: dict) -> QWidget:
    """웹뷰 + 상단 버튼바(새로고침/DevTools) 패널. 콘솔 캡처는 log 로."""
    wrap = QWidget()
    wrap.setObjectName("viewwrap")
    v = QVBoxLayout(wrap)
    v.setContentsMargins(6, 6, 6, 6)
    v.setSpacing(6)

    bar = QHBoxLayout()
    bar.setSpacing(6)
    reload_btn = QPushButton(tr["reload"])
    dev_btn = QPushButton(tr["devtools"])
    bar.addWidget(reload_btn)
    bar.addWidget(dev_btn)
    bar.addStretch(1)
    v.addLayout(bar)

    view = QWebEngineView()
    page = LoggingPage(log, view)
    view.setPage(page)
    view.setUrl(QUrl(url))
    v.addWidget(view, 1)

    dev_view = QWebEngineView()
    dev_view.setWindowTitle("DevTools")
    page.setDevToolsPage(dev_view.page())

    def toggle() -> None:
        dev_view.resize(950, 640)
        dev_view.show()
        dev_view.raise_()

    reload_btn.clicked.connect(view.reload)
    dev_btn.clicked.connect(toggle)
    return wrap


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

    g_log = QPlainTextEdit(); g_log.setReadOnly(True); g_log.setMaximumBlockCount(1000)
    s_log = QPlainTextEdit(); s_log.setReadOnly(True); s_log.setMaximumBlockCount(1000)

    g_view = _dock(win, tr["glasses_view"], _view_panel(args.harness, g_log, tr), L)
    s_view = _dock(win, tr["settings_view"], _view_panel(args.settings, s_log, tr), R)
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
