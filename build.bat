@echo off
chcp 65001 >nul
setlocal

rem 확장 번들을 굽는다. 두 번 눌러 실행해도 된다.
rem
rem 결과는 동기화 폴더(OneDrive 등) 밖에 두어야 한다 — 안에 두면 브라우저가
rem 재시작할 때 그 폴더를 읽지 못해 압축해제 확장을 목록에서 버린다.
rem
rem   build.bat                  C:\ext\x-deck 에 굽는다
rem   build.bat D:\ext\x-deck    적은 자리에 굽는다 (절대 경로로 적는다)
rem
rem 환경 변수 XDECK_OUT 을 정해 두었으면 기본 자리 대신 그 값을 쓴다.

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
node "scripts\build.mjs" --out "%OUT%"
set "CODE=%ERRORLEVEL%"
popd

if not "%CODE%"=="0" (
  echo.
  echo 빌드에 실패했습니다. 위 메시지를 확인하세요.
  echo.
  pause
  exit /b %CODE%
)

echo.
echo 브라우저의 확장 페이지에서 이 폴더를 로드하세요:
echo     %OUT%
echo.
pause
