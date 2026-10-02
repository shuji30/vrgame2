@echo off
rem TURBO KART VR - FFB ブリッジ起動（初回は依存パッケージを自動インストール）
chcp 65001 > nul
cd /d "%~dp0"
if not exist .venv (
  echo 初回セットアップ中...
  py -3 -m venv .venv 2> nul || python -m venv .venv
)
call .venv\Scripts\activate.bat
python -m pip install -q --disable-pip-version-check -r requirements.txt
python bridge.py %*
pause
