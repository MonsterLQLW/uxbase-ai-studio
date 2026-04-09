@echo off
cd /d "C:\Users\lqqingli\Ux-ai-studio"
echo Starting UXbase AI Studio...
echo.
echo If browser does not open automatically, go to:
echo   http://localhost:5173
echo.
start http://localhost:5173
npx vite --host --port 5173