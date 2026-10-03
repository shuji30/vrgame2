@echo off
rem サイト一式（ゲーム + オンライン対戦サーバー）をレンタルサーバーへデプロイする
rem 初回は接続先を質問します。設定し直すときは deploy.bat --setup
chcp 65001 > nul
cd /d "%~dp0"
node scripts\deploy.mjs %*
pause
