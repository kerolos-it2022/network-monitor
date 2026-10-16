@echo off
REM ============================================================
REM  Network Monitor - Enable Device Name Discovery
REM  Run as Administrator on each Windows machine.
REM  1) Network profile -> Private   2) Enable Network Discovery
REM  3) Start FDResPub + SSDPSRV     4) Enable NetBIOS over TCP/IP
REM ============================================================
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo [!] Please run as Administrator.
  pause
  exit /b 1
)
echo [*] Setting network profile to Private...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$p = Get-NetConnectionProfile; foreach ($x in $p) { Set-NetConnectionProfile -InterfaceIndex $x.InterfaceIndex -NetworkCategory Private }"
echo [*] Enabling Network Discovery firewall rules...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-NetFirewallRule -DisplayGroup 'Network Discovery' -Enabled True"
echo [*] Enabling discovery services (FDResPub / SSDPSRV / upnphost)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-Service FDResPub -StartupType Automatic; Set-Service SSDPSRV -StartupType Automatic; Set-Service upnphost -StartupType Manual; Start-Service FDResPub; Start-Service SSDPSRV; Start-Service upnphost" 
echo [*] Enabling NetBIOS over TCP/IP on all IP adapters...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$nics = Get-WmiObject Win32_NetworkAdapterConfiguration -Filter 'IPEnabled=True'; foreach ($n in $nics) { $n.SetTcpipNetbios(0) | Out-Null }"
echo.
echo [✓] Done — device now broadcasts its name on the network.
echo     Run a scan from the dashboard in ~5 minutes to pick it up.
pause
