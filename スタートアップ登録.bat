@echo off
chcp 65001 > nul
set STARTUP=C:\Users\turgi\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup
copy /Y "%~dp0start.vbs" "%STARTUP%\運営管理アプリ.vbs"
if %errorlevel% equ 0 (
  echo 登録完了！次回PC起動時から自動的にサーバーが起動します。
) else (
  echo コピー失敗。パスを確認してください：
  echo %STARTUP%
)
pause
