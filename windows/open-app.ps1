# Opens LTTV in its own app window (no tabs or address bar) once it's running.
param([string]$Url = 'http://127.0.0.1:8787/')
for ($i = 0; $i -lt 60; $i++) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 1 ($Url + 'api/caps') | Out-Null; break } catch { Start-Sleep -Milliseconds 500 }
}
$browsers = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe",
  "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe"
)
foreach ($b in $browsers) {
  if ($b -and (Test-Path $b)) { Start-Process $b -ArgumentList "--app=$Url", '--start-maximized'; exit 0 }
}
Start-Process $Url
