param(
    [string]$ExportPath,
    [string]$KeyPath,
    [switch]$DryRun,
    [switch]$Pause
)

$ErrorActionPreference = 'Stop'
$downloads = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'Downloads'

if (-not $ExportPath) {
    Write-Host "Looking for the latest Artwork Archive export in $downloads..."
    $ExportPath = Get-ChildItem -LiteralPath $downloads -Filter 'nova-artwork-archive-*.json' -File |
        Sort-Object LastWriteTime -Descending |
        Select-Object -First 1 -ExpandProperty FullName
}
if (-not $ExportPath) { throw "No Nova Artwork Archive export was found in $downloads" }
if (-not (Test-Path -LiteralPath $ExportPath)) { throw "Export not found: $ExportPath" }

Write-Host "Syncing the latest Artwork Archive export: $ExportPath"

if (-not $env:GOOGLE_SERVICE_ACCOUNT_JSON) {
    if (-not $KeyPath) {
        throw 'Set GOOGLE_SERVICE_ACCOUNT_JSON or pass an explicit -KeyPath.'
    }
    if (-not (Test-Path -LiteralPath $KeyPath)) { throw "Service-account key not found: $KeyPath" }
    $credentials = Get-Content -Raw -LiteralPath $KeyPath
    $credentialObject = $credentials | ConvertFrom-Json
    if ($credentialObject.type -ne 'service_account') { throw "Not a Google service-account key: $KeyPath" }
    $env:GOOGLE_SERVICE_ACCOUNT_JSON = $credentials
}

Push-Location (Join-Path $PSScriptRoot '..')
try {
    $arguments = @('run', 'sync-opportunities', '--', '--source', 'artwork_archive', '--artwork-archive-export', $ExportPath)
    if ($DryRun) { $arguments += '--dry-run' }
    & npm.cmd @arguments
    if ($LASTEXITCODE -ne 0) { throw "Nova import failed with exit code $LASTEXITCODE" }
} finally {
    Pop-Location
}

Write-Host "Synced $ExportPath" -ForegroundColor Green
if ($Pause) { Read-Host 'Press Enter to close' }
