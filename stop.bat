@echo off
REM ============================================================
REM Dit Shop - stop the running server on port 3000
REM ============================================================

echo Stopping Dit Shop server on port 3000...

powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$conns = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue;" ^
  "if (-not $conns) { Write-Host '  (no server was running)' -ForegroundColor DarkGray; exit 0 }" ^
  "$conns | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object {" ^
  "  try { Stop-Process -Id $_ -Force -ErrorAction Stop; Write-Host \"  killed PID $_\" -ForegroundColor Green }" ^
  "  catch { Write-Host \"  could not kill PID $_ - $($_.Exception.Message)\" -ForegroundColor Yellow }" ^
  "}"

echo.
echo Done.
timeout /t 2 >nul
