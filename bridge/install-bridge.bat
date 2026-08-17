@echo off
chcp 65001 >nul
node "%~dp0install.mjs" %*
if errorlevel 1 echo.& echo Node.js 를 찾지 못했습니다. nodejs.org 에서 설치한 뒤 다시 실행하세요.
echo.
pause