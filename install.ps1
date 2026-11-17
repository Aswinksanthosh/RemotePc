# Remote Start PC installer.
# Run by Install.cmd, or from PowerShell with the one-line command in README.md.
#
# What it does: asks Windows for permission once, installs Node.js if it is missing, then
# hands over to the real installer (bin\setup.mjs), which does the rest and shows a QR code.
# Safe to run again.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
try { chcp 65001 | Out-Null } catch {}
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$Repo = 'Aswinksanthosh/RemotePc'
$Branch = 'main'

function Say($text, $color) {
  if ($color) { Write-Host $text -ForegroundColor $color } else { Write-Host $text }
}

function Stop-WithMessage($text) {
  Say ''
  Say $text 'Red'
  Say ''
  Read-Host 'Press Enter to close this window'
  exit 1
}

# -- 1. Administrator rights: Windows asks one Yes / No question -------------------------
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$isAdmin = (New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Say 'Windows will now ask for permission to make changes. Please answer Yes.' 'Yellow'
  $self = $PSCommandPath
  if (-not $self) {
    # Started from the one-line command: save this script to a file so it can be run again with rights.
    $self = Join-Path $env:TEMP 'remortstartpc-install.ps1'
    try {
      Invoke-WebRequest -UseBasicParsing -Uri "https://raw.githubusercontent.com/$Repo/$Branch/install.ps1" -OutFile $self
    } catch {
      Stop-WithMessage 'Could not download the installer. Check your internet connection. (If the project is private, it has to be made public first.)'
    }
  }
  try {
    Start-Process -FilePath 'powershell.exe' -Verb RunAs -Wait -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $self + '"'))
  } catch {
    Stop-WithMessage 'The installer needs permission to make changes (to install Tailscale and allow your phone through the firewall). Run it again and answer Yes.'
  }
  exit
}

Say ''
Say '=====================================' 'Cyan'
Say '  Remote Start PC - installer' 'Cyan'
Say '=====================================' 'Cyan'
Say ''

# -- 2. Node.js ---------------------------------------------------------------------------
function Get-NodeExe {
  $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
  if (-not $cmd) { return $null }
  try {
    $v = (& $cmd.Source --version) -replace '^v', ''
    if ([int]($v.Split('.')[0]) -ge 20) { return $cmd.Source }
  } catch {}
  return $null
}

function Update-SessionPath {
  $machine = [Environment]::GetEnvironmentVariable('Path', 'Machine')
  $user = [Environment]::GetEnvironmentVariable('Path', 'User')
  $env:Path = "$machine;$user"
}

$node = Get-NodeExe
if ($node) {
  Say "Node.js is already installed." 'Green'
} else {
  Say 'Installing Node.js (the engine this program runs on). This takes a minute...'
  $winget = Get-Command winget.exe -ErrorAction SilentlyContinue
  if ($winget) {
    try { & winget.exe install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements | Out-Null } catch {}
    Update-SessionPath
    $node = Get-NodeExe
  }
  if (-not $node) {
    Say 'Downloading Node.js from nodejs.org instead...'
    try {
      $arch = 'x64'
      if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
      $base = 'https://nodejs.org/dist/latest-v22.x/'
      $sums = (Invoke-WebRequest -UseBasicParsing -Uri ($base + 'SHASUMS256.txt')).Content
      $line = ($sums -split "`n") | Where-Object { $_ -match ('node-v[0-9.]+-' + $arch + '\.msi') } | Select-Object -First 1
      if (-not $line) { throw 'no installer listed' }
      $parts = $line.Trim() -split '\s+'
      $msi = Join-Path $env:TEMP $parts[1]
      Invoke-WebRequest -UseBasicParsing -Uri ($base + $parts[1]) -OutFile $msi
      if ((Get-FileHash -LiteralPath $msi -Algorithm SHA256).Hash -ne $parts[0]) {
        Remove-Item -LiteralPath $msi -Force
        throw 'the download did not match its checksum'
      }
      Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', ('"' + $msi + '"'), '/qn', '/norestart') -Wait
    } catch {
      Say ('Could not install Node.js automatically: ' + $_.Exception.Message) 'Yellow'
    }
    Update-SessionPath
    $node = Get-NodeExe
  }
  if (-not $node) {
    Stop-WithMessage 'Node.js could not be installed. Install it by hand from https://nodejs.org (the LTS version), then run this installer again.'
  }
  Say 'Node.js is ready.' 'Green'
}

# -- 3. The program files -----------------------------------------------------------------
$src = $null
if ($PSScriptRoot -and (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'bin\setup.mjs'))) {
  $src = $PSScriptRoot
} else {
  Say 'Downloading Remote Start PC...'
  try {
    $tmp = Join-Path $env:TEMP ('remortstartpc-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    $zip = $tmp + '.zip'
    Invoke-WebRequest -UseBasicParsing -Uri "https://codeload.github.com/$Repo/zip/refs/heads/$Branch" -OutFile $zip
    Expand-Archive -LiteralPath $zip -DestinationPath $tmp -Force
    $inner = Get-ChildItem -LiteralPath $tmp -Directory | Select-Object -First 1
    $src = $inner.FullName
  } catch {
    Stop-WithMessage ('Could not download the program: ' + $_.Exception.Message + ' (If the project is private, it has to be made public first.)')
  }
}

# -- 4. The real installer ----------------------------------------------------------------
& $node (Join-Path $src 'bin\setup.mjs') --source $src
$code = $LASTEXITCODE

Say ''
Read-Host 'Press Enter to close this window'
exit $code
