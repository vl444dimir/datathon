$ErrorActionPreference = 'Stop'
$taskRepo = 'vl444dimir/datathon'
$taskTag = 'initial-archive'
$taskDir = Join-Path $PSScriptRoot '.local-archive'
$taskDownloadDir = Join-Path $taskDir 'download'
New-Item -ItemType Directory -Path $taskDownloadDir -Force | Out-Null
if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw 'Install GitHub CLI and sign in with gh auth login before downloading this private release.'
}
gh release download $taskTag --repo $taskRepo --pattern 'dataset-parts.json' --dir $taskDownloadDir --skip-existing
if ($LASTEXITCODE -ne 0) { throw 'Could not download the archive manifest.' }
$taskManifest = Get-Content -LiteralPath (Join-Path $taskDownloadDir 'dataset-parts.json') -Raw | ConvertFrom-Json
if ($taskManifest.archive_name -ne 'synthetic_microdata_2021-2024_20260921.zip') { throw 'Unexpected archive name.' }
if ($taskManifest.archive_sha256 -notmatch '^[a-f0-9]{64}$') { throw 'Invalid archive checksum.' }
$taskArchivePath = Join-Path $taskDir $taskManifest.archive_name
if ((Test-Path -LiteralPath $taskArchivePath) -and (Get-FileHash -LiteralPath $taskArchivePath -Algorithm SHA256).Hash.ToLowerInvariant() -eq $taskManifest.archive_sha256) {
    Write-Output "Verified archive is already available: $taskArchivePath"
    return
}
if (Test-Path -LiteralPath $taskArchivePath) { throw 'An archive with different content already exists. Move it aside before retrying.' }
gh release download $taskTag --repo $taskRepo --pattern 'synthetic_microdata_2021-2024_20260921.zip.part*' --dir $taskDownloadDir --skip-existing
if ($LASTEXITCODE -ne 0) { throw 'Could not download all archive parts. Run this script again to resume.' }
$taskTotalBytes = [long]0
foreach ($taskPart in $taskManifest.parts) {
    if ($taskPart.name -notmatch '^synthetic_microdata_2021-2024_20260921\.zip\.part[0-9]{3}$') { throw 'Invalid part name.' }
    if ($taskPart.sha256 -notmatch '^[a-f0-9]{64}$' -or [long]$taskPart.bytes -le 0) { throw 'Invalid part metadata.' }
    $taskPartPath = Join-Path $taskDownloadDir $taskPart.name
    if ((Get-Item -LiteralPath $taskPartPath).Length -ne [long]$taskPart.bytes) { throw "Part size mismatch: $($taskPart.name)" }
    if ((Get-FileHash -LiteralPath $taskPartPath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskPart.sha256) { throw "Part checksum mismatch: $($taskPart.name)" }
    $taskTotalBytes += [long]$taskPart.bytes
}
if ($taskTotalBytes -ne [long]$taskManifest.archive_bytes) { throw 'Archive size mismatch.' }
$taskOutput = [IO.File]::Open($taskArchivePath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)
try {
    foreach ($taskPart in $taskManifest.parts) {
        $taskInput = [IO.File]::OpenRead((Join-Path $taskDownloadDir $taskPart.name))
        try { $taskInput.CopyTo($taskOutput) } finally { $taskInput.Dispose() }
    }
} finally { $taskOutput.Dispose() }
if ((Get-FileHash -LiteralPath $taskArchivePath -Algorithm SHA256).Hash.ToLowerInvariant() -ne $taskManifest.archive_sha256) { throw 'Assembled archive checksum mismatch.' }
Write-Output "Archive downloaded and SHA-256 verified: $taskArchivePath"
