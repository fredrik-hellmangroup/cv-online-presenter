$ErrorActionPreference = 'Stop'
$verifyScriptPath = Join-Path $PSScriptRoot 'verify-build-metadata.ps1'
$temporaryRoot = Join-Path ([IO.Path]::GetTempPath()) "cv-online-presenter-metadata-test-$([guid]::NewGuid().ToString('N'))"
$expectedPath = Join-Path $temporaryRoot 'expected.json'
$servedPath = Join-Path $temporaryRoot 'served'
$serverScriptPath = Join-Path $temporaryRoot 'server.py'
$port = Get-Random -Minimum 30000 -Maximum 45000
$server = $null

function Invoke-MetadataVerification {
    param(
        [Parameter(Mandatory = $true)][string]$ExpectedMetadataPath,
        [string]$MetadataUrl = "http://127.0.0.1:$port/build-metadata.json"
    )

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $output = & powershell.exe -NoProfile -NonInteractive -File $verifyScriptPath `
            -Url $MetadataUrl `
            -ExpectedMetadataPath $ExpectedMetadataPath 2>&1
        $exitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    return [PSCustomObject]@{
        ExitCode = $exitCode
        Output = ($output -join [Environment]::NewLine)
    }
}

New-Item -ItemType Directory -Path $servedPath | Out-Null
$liveMetadata = @{
    appRevision = '1111111111111111111111111111111111111111'
    contentRevision = '2222222222222222222222222222222222222222'
    buildId = 'test-build'
}
$utf8WithoutBom = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText(
    (Join-Path $servedPath 'build-metadata.json'),
    ($liveMetadata | ConvertTo-Json),
    $utf8WithoutBom
)
[IO.File]::WriteAllText($expectedPath, ($liveMetadata | ConvertTo-Json), $utf8WithoutBom)
[IO.File]::WriteAllText(
    $serverScriptPath,
    @'
import http.server
import pathlib
import sys

port = int(sys.argv[1])
root = pathlib.Path(sys.argv[2])

class Handler(http.server.BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/redirect":
            self.send_response(302)
            self.send_header("Location", "/build-metadata.json")
            self.end_headers()
            return
        if self.path == "/build-metadata.json":
            content = (root / "build-metadata.json").read_bytes()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, format, *args):
        pass

http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
'@,
    $utf8WithoutBom
)

try {
    $server = Start-Process python `
        -ArgumentList @($serverScriptPath, $port, $servedPath) `
        -PassThru `
        -WindowStyle Hidden

    $deadline = [DateTime]::UtcNow.AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 100
        try {
            Invoke-WebRequest -Uri "http://127.0.0.1:$port/build-metadata.json" -UseBasicParsing | Out-Null
            $ready = $true
        }
        catch {
            $ready = $false
        }
    } until ($ready -or [DateTime]::UtcNow -ge $deadline)
    if (-not $ready) {
        throw 'The local metadata test server did not start.'
    }

    $matching = Invoke-MetadataVerification -ExpectedMetadataPath $expectedPath
    if ($matching.ExitCode -ne 0 -or $matching.Output -notmatch 'Build metadata verification passed') {
        throw "Matching metadata was rejected. Output: $($matching.Output)"
    }

    $redirected = Invoke-MetadataVerification `
        -ExpectedMetadataPath $expectedPath `
        -MetadataUrl "http://127.0.0.1:$port/redirect"
    if ($redirected.ExitCode -eq 0) {
        throw 'A redirected metadata response was not rejected.'
    }

    $mismatch = $liveMetadata.Clone()
    $mismatch.appRevision = '3333333333333333333333333333333333333333'
    [IO.File]::WriteAllText($expectedPath, ($mismatch | ConvertTo-Json), $utf8WithoutBom)
    $nonMatching = Invoke-MetadataVerification -ExpectedMetadataPath $expectedPath
    if ($nonMatching.ExitCode -eq 0 -or $nonMatching.Output -notmatch 'appRevision') {
        throw "Mismatched metadata was not rejected. Output: $($nonMatching.Output)"
    }
}
finally {
    if ($null -ne $server -and -not $server.HasExited) {
        Stop-Process -Id $server.Id
        $server.WaitForExit()
    }
    Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Output 'Build metadata verifier tests passed.'
