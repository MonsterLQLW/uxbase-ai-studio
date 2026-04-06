@echo off
echo Initializing Git repository...

"C:\Program Files\Git\cmd\git.exe" init
"C:\Program Files\Git\cmd\git.exe" add .

echo.
echo Enter a commit message and press Enter:
"C:\Program Files\Git\cmd\git.exe" commit -m "initial commit"

echo.
echo Adding remote origin...
"C:\Program Files\Git\cmd\git.exe" remote add origin https://github.com/YOUR_USERNAME/uxbase-ai-studio.git

echo.
echo Pushing to GitHub...
"C:\Program Files\Git\cmd\git.exe" branch -M main
"C:\Program Files\Git\cmd\git.exe" push -u origin main

echo.
echo Done!
pause
