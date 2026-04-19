#!/usr/bin/env pwsh
<#
Downloads MaxMind GeoLite2-City and GeoLite2-ASN databases into src-tauri/resources/.

Requires the MAXMIND_LICENSE_KEY environment variable.
Get a free license key at https://www.maxmind.com/en/geolite2/signup

Usage:
    $env:MAXMIND_LICENSE_KEY = "your-key-here"
    pwsh scripts/download-geolite.ps1
#>

$ErrorActionPreference = "Stop"

$licenseKey = $env:MAXMIND_LICENSE_KEY
if ([string]::IsNullOrWhiteSpace($licenseKey)) {
    Write-Error "MAXMIND_LICENSE_KEY environment variable is not set."
    exit 1
}

$repoRoot = Split-Path -Parent $PSScriptRoot
$resourcesDir = Join-Path $repoRoot "src-tauri/resources"
New-Item -ItemType Directory -Force -Path $resourcesDir | Out-Null

$editions = @("GeoLite2-City", "GeoLite2-ASN")

foreach ($edition in $editions) {
    Write-Host "Downloading $edition..."

    $url = "https://download.maxmind.com/app/geoip_download?edition_id=$edition&license_key=$licenseKey&suffix=tar.gz"
    $tmp = New-TemporaryFile
    $tarPath = "$($tmp.FullName).tar.gz"
    Move-Item -Path $tmp.FullName -Destination $tarPath

    try {
        Invoke-WebRequest -Uri $url -OutFile $tarPath -UseBasicParsing

        $extractDir = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
        New-Item -ItemType Directory -Force -Path $extractDir | Out-Null

        tar -xzf $tarPath -C $extractDir
        if ($LASTEXITCODE -ne 0) {
            throw "tar extraction failed for $edition"
        }

        $mmdb = Get-ChildItem -Path $extractDir -Filter "$edition.mmdb" -Recurse | Select-Object -First 1
        if (-not $mmdb) {
            throw "Could not find $edition.mmdb in downloaded archive"
        }

        $dest = Join-Path $resourcesDir "$edition.mmdb"
        Copy-Item -Path $mmdb.FullName -Destination $dest -Force
        # Bump mtime to now so Tauri's resource-copy step picks up the fresh file.
        (Get-Item $dest).LastWriteTime = Get-Date
        Write-Host "  -> $dest ($([math]::Round($mmdb.Length / 1MB, 1)) MB)"

        Remove-Item -Path $extractDir -Recurse -Force
    }
    finally {
        if (Test-Path $tarPath) { Remove-Item -Path $tarPath -Force }
    }
}

Write-Host "Done. Databases are in $resourcesDir"
