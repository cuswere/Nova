@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "try { & '%~dp0import-latest-artwork-archive.ps1' } catch { Write-Host ''; Write-Host 'IMPORT FAILED' -ForegroundColor Red; Write-Host $_.Exception.Message -ForegroundColor Red; exit 1 } finally { Write-Host ''; Read-Host 'Press Enter to close' | Out-Null }"
exit /b %ERRORLEVEL%
