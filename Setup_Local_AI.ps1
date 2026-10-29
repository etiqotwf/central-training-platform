# Run from PowerShell in the project folder. Keeps all existing Google/email settings.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Write-Host 'Installing Ollama from its Windows package...'
        winget install --id Ollama.Ollama --exact --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw 'Ollama installation failed. Install from https://ollama.com/download/windows' }
        $env:Path += ';' + (Join-Path $env:LOCALAPPDATA 'Programs\Ollama')
    }
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
        throw 'Install Ollama from https://ollama.com/download/windows then run this script again in a new PowerShell window.'
    }
}
try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 | Out-Null }
catch { Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden; Start-Sleep -Seconds 3 }
Write-Host 'Downloading the open-weight Qwen3 4B model (several GB, first run only)...'
ollama pull qwen3:4b
if ($LASTEXITCODE -ne 0) { throw 'Model download failed. Check connection and disk space.' }
ollama create british-tutor-v1 -f .\local-llm\Modelfile
if ($LASTEXITCODE -ne 0) { throw 'Model setup failed.' }
$envFile = Join-Path $PSScriptRoot '.env'
if (-not (Test-Path $envFile)) { throw 'Your existing .env file was not found. Create your platform configuration first; this script will not overwrite it.' }
$lines = [System.IO.File]::ReadAllLines($envFile)
$updates = [ordered]@{ AI_PROVIDER='ollama'; OLLAMA_BASE_URL='http://127.0.0.1:11434'; OLLAMA_MODEL='british-tutor-v1' }
foreach ($key in $updates.Keys) {
    $seen = $false
    $output = New-Object System.Collections.Generic.List[string]
    foreach ($line in $lines) {
        if ($line -match ('^\s*' + [regex]::Escape($key) + '\s*=')) {
            if (-not $seen) { $output.Add($key + '=' + $updates[$key]); $seen = $true }
        } else { $output.Add($line) }
    }
    if (-not $seen) { $output.Add($key + '=' + $updates[$key]) }
    $lines = $output.ToArray()
}
[System.IO.File]::WriteAllLines($envFile, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host 'Local AI is ready. Existing Google/email settings were kept. Restart node server.js.'
Write-Host 'The adaptive engine works without Ollama; enable each course from the learning center.'
