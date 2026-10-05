@echo off
rem TURBO KART VR - デバイスブリッジを Windows のログオン時に自動起動する（1 回だけ実行）
chcp 65001 > nul
cd /d "%~dp0"
if exist TurboKartBridge.exe (
  rem 配布版: 最小化した画面で起動する
  powershell -NoProfile -ExecutionPolicy Bypass -Command "$d='%~dp0'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\TurboKart Device Bridge.lnk'); $s.TargetPath=$d+'TurboKartBridge.exe'; $s.Arguments='--max 0.3'; $s.WorkingDirectory=$d; $s.WindowStyle=7; $s.Save()"
  start "" /min "%~dp0TurboKartBridge.exe" --max 0.3
  goto done
)
if not exist .venv (
  echo 初回セットアップ中...
  py -3 -m venv .venv 2> nul || python -m venv .venv
)
.venv\Scripts\python -m pip install -q --disable-pip-version-check -r requirements.txt
rem スタートアップにショートカットを作る（pythonw で画面を出さずに起動）
powershell -NoProfile -ExecutionPolicy Bypass -Command "$d='%~dp0'; $s=(New-Object -ComObject WScript.Shell).CreateShortcut([Environment]::GetFolderPath('Startup')+'\TurboKart Device Bridge.lnk'); $s.TargetPath=$d+'.venv\Scripts\pythonw.exe'; $s.Arguments='\"'+$d+'bridge.py\" --max 0.3'; $s.WorkingDirectory=$d; $s.Save()"
rem いますぐ起動（すでに起動中なら何もしない）
start "" "%~dp0.venv\Scripts\pythonw.exe" "%~dp0bridge.py" --max 0.3
:done
echo.
echo 自動起動を設定しました。次回から Windows にログオンすると自動でブリッジが起動します。
echo 解除するときは uninstall-autostart.bat を実行してください。
pause
