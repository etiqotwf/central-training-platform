$ErrorActionPreference = 'Stop'

# Recommended for a PC with 16 GB RAM and an unknown/possibly integrated GPU.
# The worker can keep using the old model name qwen3:0.6b; below we create
# that name as a compatibility alias pointing to the stronger Qwen3.5 4B model.
$baseModel = 'qwen3.5:4b'
$workerModelName = 'qwen3:0.6b'

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw 'winget is missing. Install App Installer from Microsoft Store, then retry.'
}

# Install Node.js if needed
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    winget install --id OpenJS.NodeJS.LTS --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw 'Node.js installation failed.' }
}

# Install Ollama if needed
$ollamaExe = Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe'
if (-not (Get-Command ollama -ErrorAction SilentlyContinue) -and
    -not (Test-Path $ollamaExe)) {
    winget install --id Ollama.Ollama --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) { throw 'Ollama installation failed.' }
}

# Refresh paths
$machinePath = [Environment]::GetEnvironmentVariable('Path','Machine')
$userPath = [Environment]::GetEnvironmentVariable('Path','User')
$env:Path = "$machinePath;$userPath"

$ollamaCommand = Get-Command ollama -ErrorAction SilentlyContinue
if ($ollamaCommand) { $ollamaExe = $ollamaCommand.Source }
if (-not (Test-Path $ollamaExe)) {
    throw 'Ollama was not found. Restart PowerShell and retry.'
}

function Test-OllamaReady {
    try {
        $null = Invoke-RestMethod 'http://127.0.0.1:11434/api/tags' -TimeoutSec 2
        return $true
    } catch {
        return $false
    }
}

# Start Ollama if needed
if (-not (Test-OllamaReady)) {
    Start-Process -FilePath $ollamaExe -ArgumentList 'serve' -WindowStyle Minimized
}

$ready = $false
for ($attempt = 0; $attempt -lt 45; $attempt++) {
    if (Test-OllamaReady) {
        $ready = $true
        break
    }
    Start-Sleep -Seconds 1
}

if (-not $ready) {
    throw 'Ollama did not start. Open Ollama from the Start menu, then run this script again.'
}

Write-Host "Downloading $baseModel (this may take several minutes)..." -ForegroundColor Cyan
& $ollamaExe pull $baseModel
if ($LASTEXITCODE -ne 0) {
    throw 'Model download failed. Check the internet connection and available disk space, then retry.'
}

# Create a stronger model under the old tag so existing worker scripts that
# request qwen3:0.6b continue to work without editing their configuration.
$modelfile = Join-Path $env:TEMP 'Ollama-Qwen35-4B.Modelfile'
@"
FROM $baseModel
PARAMETER num_ctx 8192
PARAMETER num_predict 2048
PARAMETER temperature 0.7
PARAMETER top_p 0.8
"@ | Set-Content -Path $modelfile -Encoding UTF8

Write-Host "Creating compatibility model name: $workerModelName ..." -ForegroundColor Cyan
& $ollamaExe create $workerModelName -f $modelfile
if ($LASTEXITCODE -ne 0) {
    throw 'The model was downloaded, but creating the worker-compatible model name failed.'
}

Write-Host ''
Write-Host 'SUCCESS: Qwen3.5 4B is installed and configured.' -ForegroundColor Green
Write-Host "Worker model name: $workerModelName" -ForegroundColor Green
Write-Host 'Context: 8192 tokens | Maximum generated answer: 2048 tokens' -ForegroundColor Green
Write-Host 'Next: Open Start_Worker.cmd from your USB drive.' -ForegroundColor Yellow
Write-Host 'Note: This setup script keeps compatibility with the old model name. If another app explicitly overrides the model name, update that setting too.' -ForegroundColor Yellow
