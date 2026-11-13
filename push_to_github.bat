@echo off
title GitHub'a Yukle (Push)
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.local\mingit\cmd;%PATH%"

echo =======================================================
echo   PROJE GITHUB'A YUKLENIYOR
echo =======================================================
echo.
echo Depo: https://github.com/ecemozgur/bak-masist.git
echo.
echo Tarayicida giris penceresi acilirsa "Sign in with browser" ile onaylayiniz...
echo.

git push -u origin main

echo.
echo =======================================================
if %ERRORLEVEL% equ 0 (
    echo Basariyla GitHub'a yuklendi!
) else (
    echo Yukleme sirasinda bir sorun olustu.
)
echo =======================================================
pause
