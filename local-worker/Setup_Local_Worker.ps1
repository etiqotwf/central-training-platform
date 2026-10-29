# Standalone inference setup. It never reads the platform .env or Google credentials.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { throw 'Install Node.js 20 or later, then run again.' }
if (-not (Test-Path '.\local-worker-config.json')) { throw 'Download local-worker-config.json from the ONLINE platform > Local Generation, and copy it into this folder first.' }
if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        winget install --id Ollama.Ollama --exact --silent --accept-package-agreements --accept-source-agreements
        if ($LASTEXITCODE -ne 0) { throw 'Install Ollama from https://ollama.com/download/windows then run again.' }
        $env:Path += ';' + (Join-Path $env:LOCALAPPDATA 'Programs\Ollama')
    }
    if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) { throw 'Install Ollama from https://ollama.com/download/windows and open a new PowerShell window.' }
}
try { Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 3 | Out-Null }
catch { Start-Process -FilePath 'ollama' -ArgumentList 'serve' -WindowStyle Hidden; Start-Sleep -Seconds 3 }
Write-Host 'Downloading the base model (first time only, several GB)...'
ollama pull qwen3:4b
if ($LASTEXITCODE -ne 0) { throw 'Could not download the model.' }
ollama create british-tutor-v1 -f ..\local-llm\Modelfile
if ($LASTEXITCODE -ne 0) { throw 'Could not create the local model profile.' }
Write-Host 'Starting the worker. Keep this window open. Your platform .env was not changed.'
node .\worker.cjs
