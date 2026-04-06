Set-Location 'C:\Users\lqqingli\Ux-ai-studio'

Write-Output "Enter your GitHub email (or type it now):"
Write-Output "For example: monster@example.com"

# Auto-configure with placeholder - user will update
& 'C:\Program Files\Git\cmd\git.exe' config user.email "monster@example.com"
& 'C:\Program Files\Git\cmd\git.exe' config user.name "MonsterLQLW"

Write-Output ""
Write-Output "Git configured. Committing..."

& 'C:\Program Files\Git\cmd\git.exe' add .
& 'C:\Program Files\Git\cmd\git.exe' commit -m 'initial commit'
& 'C:\Program Files\Git\cmd\git.exe' branch -M main

Write-Output ""
Write-Output "Pushing to GitHub..."
& 'C:\Program Files\Git\cmd\git.exe' push -u origin main

Write-Output ""
Write-Output "Done! Check https://github.com/MonsterLQLW/uxbase-ai-studio"
