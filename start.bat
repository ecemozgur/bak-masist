@echo off
title Akilli Fabrika Bakim ve Doruk MES Asistani
echo =======================================================
echo   AKILLI FABRIKA BAKIM VE DORUK MES SISTEMI BASLATILIYOR
echo =======================================================
echo.

cd /d "%~dp0"

if not exist ".venv\Scripts\python.exe" (
    echo [HATA] Sanal ortam bulunamadi!
    echo Lutfen kurulum adimlarini tamamlayiniz.
    pause
    exit /b 1
)

echo [1/2] IP Adresi tespit ediliyor (Telefonlardan erisim icin)...
for /f "tokens=4" %%a in ('route print ^| findstr 0.0.0.0.*0.0.0.0') do (
    set LOCAL_IP=%%a
)

echo.
echo =======================================================
echo  Bilgisayardan erisim:  http://127.0.0.1:8000
echo                         http://localhost:8000
if defined LOCAL_IP (
    echo  Telefondan erisim:     http://%LOCAL_IP%:8000
)
echo =======================================================
echo.
echo Tarayici 2 saniye icinde otomatik acilacak...
echo Sunucu calisiyor... Kapatmak icin bu pencereyi kapatiniz.
echo.

start /min cmd /c "timeout /t 2 >nul & start http://127.0.0.1:8000"
".venv\Scripts\python.exe" -m uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
pause
