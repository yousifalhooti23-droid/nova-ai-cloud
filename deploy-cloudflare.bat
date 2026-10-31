@echo off
chcp 65001 >nul
title NOVA AI Cloud - Free Cloudflare Deploy
cd /d "%~dp0"
echo ========================================================
echo   NOVA AI Cloud - الرفع المجاني على Cloudflare Workers
echo   (بدون بطاقة بنكية - $0)
echo ========================================================
echo.
node scripts/deploy-cloudflare.mjs
echo.
pause
