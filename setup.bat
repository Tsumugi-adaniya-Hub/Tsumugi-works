@echo off
cd /d "%~dp0"
echo === npm install ===
npm install
echo.
echo === googleapis インストール ===
npm install googleapis
echo.
echo === フォントセットアップ ===
npm run setup-fonts
echo.
echo === セットアップ完了 ===
echo npm start で起動できます
pause
