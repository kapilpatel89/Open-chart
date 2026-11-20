@echo off
title NexusView Pro - 3D Trading Terminal
echo ========================================================
echo   NexusView Pro - Advanced Trading Terminal
echo   CoinDCX WebSockets + 3D Candlesticks + Pine Script IDE
echo ========================================================
echo.
echo Starting FastAPI Server on http://127.0.0.1:8000 ...
python -m uvicorn server:app --host 127.0.0.1 --port 8000
pause
