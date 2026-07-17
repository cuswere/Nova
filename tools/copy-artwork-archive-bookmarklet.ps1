$ErrorActionPreference = 'Stop'

$collectorPath = Join-Path $PSScriptRoot 'artwork-archive-collector.js'
$collector = (Get-Content -Raw -LiteralPath $collectorPath).Trim() -replace "`r?`n\s*", ' '
$bookmarklet = "javascript:$collector"

Set-Clipboard -Value $bookmarklet
Write-Host 'The Artwork Archive collector bookmarklet is on your clipboard.' -ForegroundColor Green
Write-Host 'In Vivaldi, create a bookmark and paste it into the bookmark URL field.'
Read-Host 'Press Enter to close'
