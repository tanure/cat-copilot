param(
    [string]$ReleaseDirectory = (Join-Path $PSScriptRoot '..\release')
)

$ErrorActionPreference = 'Stop'
$publisher = $env:CATPILOT_SIGNING_PUBLISHER
if ([string]::IsNullOrWhiteSpace($publisher)) {
    throw 'CATPILOT_SIGNING_PUBLISHER is required to verify release signatures.'
}
$publisher = $publisher.Trim()
$version = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
$files = @(
    (Join-Path $ReleaseDirectory 'win-unpacked\CatPilot.exe'),
    (Join-Path $ReleaseDirectory "CatPilot Setup $version.exe")
)

foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) {
        throw "Expected signed release file is missing: $file"
    }
    $signature = Get-AuthenticodeSignature -LiteralPath $file
    if ($signature.Status -ne 'Valid') {
        throw "Authenticode verification failed for ${file}: $($signature.Status)"
    }
    if ($null -eq $signature.SignerCertificate -or $null -eq $signature.TimeStamperCertificate) {
        throw "Release signature requires a publisher certificate and timestamp: $file"
    }
    $actualPublisher = $signature.SignerCertificate.GetNameInfo(
        [System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false
    )
    if (-not [string]::Equals($actualPublisher, $publisher, [StringComparison]::Ordinal)) {
        throw "Release signature does not match CATPILOT_SIGNING_PUBLISHER: $file"
    }
    Write-Output "Verified trusted publisher signature and timestamp: $file"
}
