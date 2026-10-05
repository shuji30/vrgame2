@echo off
rem TURBO KART VR - デバイスブリッジ起動
rem 配布版（TurboKartBridge.exe がある）はそのまま起動。Python 版は初回に依存パッケージを自動インストール
chcp 65001 > nul
cd /d "%~dp0"
if exist TurboKartBridge.exe (
  TurboKartBridge.exe %*
  pause
  exit /b
)
if not exist .venv (
  echo 初回セットアップ中...
  py -3 -m venv .venv 2> nul || python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install -q --disable-pip-version-check -r requirements.txt
python bridge.py %*
pause
