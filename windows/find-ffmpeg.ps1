# Prints the path to ffmpeg.exe if it's on this computer (on PATH, or installed by winget but not on PATH yet).
$c = Get-Command ffmpeg -ErrorAction SilentlyContinue
if ($c) { $c.Source; exit 0 }
$roots = @("$env:LOCALAPPDATA\Microsoft\WinGet\Packages", "$env:LOCALAPPDATA\Microsoft\WinGet\Links", "$env:ProgramFiles\ffmpeg", 'C:\ffmpeg')
foreach ($r in $roots) {
  if (Test-Path $r) {
    $f = Get-ChildItem -Path $r -Filter ffmpeg.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($f) { $f.FullName; exit 0 }
  }
}
