# GameRoute Windows Build Script
# This script builds the capture service first, then builds the Tauri app

$ErrorActionPreference = "Stop"

Write-Host "=== GameRoute Windows Build ===" -ForegroundColor Cyan

# Step 1: Build the capture service
Write-Host "`n[1/3] Building capture service..." -ForegroundColor Yellow
Push-Location src-tauri
cargo build --release --bin gameroute-capture-service
if ($LASTEXITCODE -ne 0) {
    Write-Host "Failed to build capture service" -ForegroundColor Red
    Pop-Location
    exit 1
}
Pop-Location

# Step 2: Copy service to a location Tauri can bundle
Write-Host "`n[2/3] Preparing service binary for bundling..." -ForegroundColor Yellow
$serviceBinary = "src-tauri\target\release\gameroute-capture-service.exe"
$bundleDir = "src-tauri\binaries"

if (!(Test-Path $bundleDir)) {
    New-Item -ItemType Directory -Path $bundleDir | Out-Null
}

Copy-Item $serviceBinary "$bundleDir\gameroute-capture-service-x86_64-pc-windows-msvc.exe" -Force
Write-Host "Service binary copied to $bundleDir" -ForegroundColor Green

# Step 3: Build the Tauri app
Write-Host "`n[3/3] Building Tauri app..." -ForegroundColor Yellow
pnpm tauri build

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n=== Build Complete ===" -ForegroundColor Green
    Write-Host "Installer location: src-tauri\target\release\bundle\nsis\" -ForegroundColor Cyan
} else {
    Write-Host "`n=== Build Failed ===" -ForegroundColor Red
    exit 1
}
