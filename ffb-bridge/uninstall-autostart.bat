@echo off
rem TURBO KART VR - デバイスブリッジの自動起動を解除して停止する
chcp 65001 > nul
del "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\TurboKart Device Bridge.lnk" 2> nul
taskkill /im TurboKartBridge.exe /f > nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*ffb-bridge*bridge.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"
echo 自動起動を解除し、ブリッジを停止しました。
pause
