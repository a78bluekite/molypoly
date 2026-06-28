@echo off
chcp 65001 >nul
title MolyPoly 두더지 잡기 서버
cd /d "%~dp0"
setlocal enabledelayedexpansion

echo ========================================
echo   MolyPoly 두더지 잡기 서버
echo ========================================
echo.

:: ── config.json 에서 고정 서브도메인 읽기 ─────────────────────────
set "TUNNEL_URL="
for /f "tokens=2 delims=:, " %%a in ('findstr "tunnel_subdomain" config.json 2^>nul') do (
    set SUBDOMAIN=%%~a
    set SUBDOMAIN=!SUBDOMAIN:"=!
    set SUBDOMAIN=!SUBDOMAIN: =!
)
if defined SUBDOMAIN (
    if "!SUBDOMAIN!" NEQ "CHANGE-ME" (
        if "!SUBDOMAIN:~0,10!" NEQ "molypoly-C" (
            set "TUNNEL_URL=https://!SUBDOMAIN!.loca.lt"
        )
    )
)

:: ── 포트 3456 비우기 ──────────────────────────────────────────────
for /f "tokens=5" %%a in ('netstat -aon 2^>nul ^| findstr ":3456 "') do (
    taskkill /PID %%a /F >nul 2>&1
)
timeout /t 1 /nobreak >nul

:: ── Node.js 찾기 ────────────────────────────────────────────────
set "NODE_EXE=node"
where node >nul 2>&1
if errorlevel 1 (
    set "BUNDLE=%~dp0..\tetris\node-runtime\node-v24.18.0-win-x64\node.exe"
    if exist "!BUNDLE!" (
        set "NODE_EXE=!BUNDLE!"
        echo [정보] Tetris 번들 Node.js 사용
    ) else (
        echo [오류] Node.js를 찾을 수 없습니다.
        echo.
        echo   방법 1: https://nodejs.org 에서 Node.js 설치
        echo   방법 2: D:\claude\tetris 폴더가 있는지 확인
        echo.
        pause
        exit /b 1
    )
)

:: ── node_modules 없으면 npm install ─────────────────────────────
if not exist node_modules (
    echo [설치] 패키지 설치 중... (최초 1회)
    set "NPM_EXE=npm"
    where npm >nul 2>&1
    if errorlevel 1 (
        set "NPM_EXE=%~dp0..\tetris\node-runtime\node-v24.18.0-win-x64\npm.cmd"
    )
    "!NPM_EXE!" install
    if errorlevel 1 (
        echo [오류] npm install 실패. 인터넷 연결을 확인하세요.
        pause
        exit /b 1
    )
    echo [완료] 설치 완료!
    echo.
)

:: ── 서버 시작 ─────────────────────────────────────────────────────
echo 서버 시작 중...
start "MolyPoly Server" "!NODE_EXE!" "%~dp0server\index.js"
timeout /t 3 /nobreak >nul

:: ── 브라우저 열기 ─────────────────────────────────────────────────
start "" "http://localhost:3456"

echo.
echo ========================================
if defined TUNNEL_URL (
    echo   [고정 공개 URL]
    echo   !TUNNEL_URL!
    echo.
    echo   이 주소를 친구들에게 알려주세요.
    echo   서버를 켤 때마다 항상 같은 주소입니다.
) else (
    echo   [공개 URL] 서버 창에서 확인하세요
    echo.
    echo   config.json 의 tunnel_subdomain 을
    echo   원하는 이름으로 바꾸면 URL이 고정됩니다.
    echo   예: "molypoly-haeeun"
    echo   → https://molypoly-haeeun.loca.lt
)
echo ========================================
echo.
echo   [내 브라우저] http://localhost:3456
echo.
echo   [WiFi URL] 같은 WiFi 기기:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
    set RAW=%%a
    set IP=!RAW: =!
    if not "!IP!"=="" (
        if not "!IP!"=="127.0.0.1" echo   http://!IP!:3456
    )
)
echo.
echo   [MolyPoly Server] 창을 닫으면 서버가 종료됩니다.
echo.
pause
