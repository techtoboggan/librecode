# LibreCode Windows installer
#
#   irm https://raw.githubusercontent.com/techtoboggan/librecode/main/scripts/install.ps1 | iex
#
# Options (via environment variables):
#   $env:LIBRECODE_VERSION       — install a specific version (e.g. "v1.0.0-preview.1")
#   $env:LIBRECODE_INSTALL_DIR   — override the install destination
#   $env:LIBRECODE_NO_PATH_HINT  — set to "1" to suppress the PATH-update hint
#
# Does NOT require admin. Installs to %LOCALAPPDATA%\LibreCode by default.

$ErrorActionPreference = "Stop"

$Repo = "techtoboggan/librecode"
$InstallDir = if ($env:LIBRECODE_INSTALL_DIR) {
  $env:LIBRECODE_INSTALL_DIR
} else {
  Join-Path $env:LOCALAPPDATA "LibreCode"
}

function Fail($msg) {
  Write-Host "error: $msg" -ForegroundColor Red
  exit 1
}

function Info($msg) {
  Write-Host "==> $msg"
}

# ─── Detect arch ──────────────────────────────────────────────────────────
# The release only ships windows-x64 for now. arm64 support pending upstream
# Bun support.
$Arch = switch ([System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture) {
  "X64"   { "x64" }
  default { Fail "unsupported arch: $_ (only x64 is shipped)" }
}

# ─── Resolve version ──────────────────────────────────────────────────────
function Resolve-Version {
  if ($env:LIBRECODE_VERSION) { return $env:LIBRECODE_VERSION }
  $resp = Invoke-WebRequest -Uri "https://github.com/$Repo/releases/latest" `
    -MaximumRedirection 0 -ErrorAction SilentlyContinue
  $location = $resp.Headers.Location
  if (-not $location) {
    Fail "failed to resolve latest release"
  }
  return ($location -split '/')[-1]
}

# ─── Download + verify + extract ──────────────────────────────────────────
function Install-LibreCode($version) {
  $zip = "librecode-windows-$Arch.zip"
  $base = "https://github.com/$Repo/releases/download/$version"

  $tmp = New-Item -ItemType Directory -Path (Join-Path $env:TEMP "librecode-install-$([guid]::NewGuid())")
  try {
    Info "Downloading $zip..."
    Invoke-WebRequest -Uri "$base/$zip" -OutFile (Join-Path $tmp $zip)

    Info "Verifying checksum..."
    try {
      $sumFile = Join-Path $tmp "SHA256SUMS"
      Invoke-WebRequest -Uri "$base/SHA256SUMS" -OutFile $sumFile
      $line = Get-Content $sumFile | Where-Object { $_ -match [regex]::Escape($zip) } | Select-Object -First 1
      if ($line) {
        $expected = ($line -split '\s+')[0]
        $actual = (Get-FileHash -Algorithm SHA256 (Join-Path $tmp $zip)).Hash.ToLower()
        if ($expected -ne $actual) {
          Fail "checksum mismatch for $zip (expected $expected, got $actual)"
        }
      } else {
        Info "Warning: no checksum entry for $zip — skipping verification"
      }
    } catch {
      Info "Warning: SHA256SUMS not available — skipping verification"
    }

    Info "Installing to $InstallDir..."
    if (-not (Test-Path $InstallDir)) {
      New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    }
    Expand-Archive -Path (Join-Path $tmp $zip) -DestinationPath $tmp -Force
    $exe = Get-ChildItem -Path $tmp -Recurse -Filter "librecode.exe" | Select-Object -First 1
    if (-not $exe) { Fail "no librecode.exe in $zip" }
    Copy-Item -Path $exe.FullName -Destination (Join-Path $InstallDir "librecode.exe") -Force
    Info "Installed $(& (Join-Path $InstallDir 'librecode.exe') --version)"
  } finally {
    Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
  }
}

# ─── PATH hint ────────────────────────────────────────────────────────────
function Show-PathHint {
  if ($env:LIBRECODE_NO_PATH_HINT -eq "1") { return }
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  if ($userPath -notlike "*$InstallDir*") {
    Write-Host ""
    Write-Host "Add $InstallDir to your PATH to use librecode:"
    Write-Host "  [Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User') + ';$InstallDir', 'User')"
    Write-Host ""
    Write-Host "Or add it via System Properties > Environment Variables."
  }
}

# ─── Main ─────────────────────────────────────────────────────────────────
$version = Resolve-Version
Info "Platform: windows-$Arch"
Info "Version:  $version"

Install-LibreCode -version $version
Show-PathHint
Info "Done. Run 'librecode --help' to get started."
