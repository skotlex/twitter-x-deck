@echo off
chcp 65001 >nul
setlocal

rem 감시(watch) 모드로 굽는다. 코드를 고치면 다시 구우므로 창을 열어 둔 채 쓴다.
rem 멈출 때는 Ctrl+C 를 누른다.
rem
rem 자리를 고르는 방법은 build.bat 과 같다.
rem
rem   dev.bat                    C:\ext\x-deck 에 굽는다
rem   dev.bat D:\ext\x-deck      적은 자리에 굽는다 (절대 경로로 적는다)

set "OUT=%~1"
if not defined OUT set "OUT=%XDECK_OUT%"
if not defined OUT set "OUT=C:\ext\x-deck"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 를 찾지 못했습니다. nodejs.org 에서 설치한 뒤 다시 실행하세요.
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0node_modules" (
  echo 의존성이 아직 없습니다. 이 폴더에서 npm install 을 한 번 실행하세요.
  echo.
  pause
  exit /b 1
)

rem vite 는 지금 폴더에서 설정을 찾는다. 어디서 실행하든 저장소 자리에서 굽는다.
pushd "%~dp0"
node "scripts\build.mjs" --watch --out "%OUT%"
set "CODE=%ERRORLEVEL%"
popd

echo.
pause
exit /b %CODE%
