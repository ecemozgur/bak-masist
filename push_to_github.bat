@echo off
title GitHub'a Proje Yukleme (Push)
cd /d "%~dp0"
set "PATH=%USERPROFILE%\.local\mingit\cmd;%PATH%"

echo =======================================================
echo     AKILLI FABRIKA BAKIM ASISTANI - GITHUB'A YUKLEME
echo =======================================================
echo.

gh auth status >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [1/2] GitHub ile baglanti kuruluyor...
    echo.
    echo Ekranda bir 8 haneli tek kullanimlik KOD goreceksiniz.
    echo Kodu kopyalayip Enter'a basiniz; acilan tarayici sayfasina yapistiriniz.
    echo.
    gh auth login -w -p https -h github.com
    gh auth setup-git
)

echo.
echo [2/2] Dosyalar GitHub'a yukleniyor (push)...
echo.
git push -u origin main

echo.
echo =======================================================
if %ERRORLEVEL% equ 0 (
    echo [TEBRIKLER] Tum proje basariyla GitHub'a yuklendi!
    echo Sayfaniz aciliyor...
    start https://github.com/ecemozgur/bak-masist
) else (
    echo [HATA] Yukleme tamamlanamadi. Lutfen penceredeki mesajlari kontrol ediniz.
)
echo =======================================================
pause
