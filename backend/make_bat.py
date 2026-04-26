bat_content = """\
@echo off
title EPSA Platform Launcher
color 0A
echo.
echo   EPSA Platform - Ethiopian Psychology Students Association
echo  =====================================================
echo.
python --version >nul 2>&1
IF %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Python not found. Install from python.org
    pause
    exit /b 1
)
if "%EPSA_LOCAL_BACKEND_HOST%"=="" set "EPSA_LOCAL_BACKEND_HOST=127.0.0.1"
if "%EPSA_LOCAL_BACKEND_PORT%"=="" set "EPSA_LOCAL_BACKEND_PORT=5000"
set "EPSA_BASE_URL=http://%EPSA_LOCAL_BACKEND_HOST%:%EPSA_LOCAL_BACKEND_PORT%"
cd /d "%~dp0backend"
echo [1/3] Installing dependencies...
pip install -r requirements.txt --quiet
echo [2/3] Starting backend on %EPSA_BASE_URL%...
start "EPSA Backend" /MIN cmd /c "python app.py"
timeout /t 3 /nobreak >nul
echo [3/3] Opening browser...
start "" "%EPSA_BASE_URL%/"
echo.
echo  =====================================================
echo   EPSA Platform is RUNNING!
echo   API:      %EPSA_BASE_URL%/api/health
echo   Frontend: %EPSA_BASE_URL%/
echo  =====================================================
echo.
echo  Press any key to stop the backend server...
pause >nul
taskkill /F /IM python.exe /FI "WINDOWTITLE eq EPSA Backend*" >nul 2>&1
echo Backend stopped. Goodbye!
"""

with open(r"c:\Users\dawit\Desktop\EPSA WEB\start.bat", "w", newline="\r\n") as handle:
    handle.write(bat_content)

print("start.bat created successfully!")
