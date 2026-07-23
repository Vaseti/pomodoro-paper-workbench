param(
    [string]$CondaExe = 'D:\DevTools\Anaconda3\Scripts\conda.exe',
    [string]$EnvironmentName = 'pomodoro-app'
)

$ErrorActionPreference = 'Stop'

. (Join-Path $PSScriptRoot 'install-utils.ps1')

$repoRoot = Split-Path -Parent $PSScriptRoot
$requirements = Join-Path $PSScriptRoot 'requirements.txt'
$prefixProbe = Join-Path $PSScriptRoot 'print-env-prefix.py'

if (-not (Test-Path -LiteralPath $CondaExe)) {
    throw "Conda was not found at $CondaExe"
}
if (-not (Test-Path -LiteralPath $prefixProbe)) {
    throw "Conda environment prefix probe was not found at $prefixProbe"
}

function Resolve-EnvironmentPath {
    param([switch]$AllowMissing)

    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        $prefixOutput = @(
            & $CondaExe run -n $EnvironmentName python $prefixProbe 2>&1
        )
        $prefixExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }

    if ($prefixExitCode -ne 0) {
        if ($AllowMissing) {
            return $null
        }

        $outputText = ($prefixOutput | ForEach-Object { [string]$_ }) -join [Environment]::NewLine
        throw "Conda environment prefix query failed with exit code $prefixExitCode. $outputText"
    }

    return Get-CondaPrefixFromOutput -OutputLines $prefixOutput
}

$environmentPath = Resolve-EnvironmentPath -AllowMissing

if (-not $environmentPath) {
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = 'Continue'
        & $CondaExe create -n $EnvironmentName python=3.13 pip -y
        $createExitCode = $LASTEXITCODE
    }
    finally {
        $ErrorActionPreference = $previousErrorActionPreference
    }
    if ($createExitCode -ne 0) {
        throw 'Conda environment creation failed.'
    }

    $environmentPath = Resolve-EnvironmentPath
}

$pythonw = Join-Path $environmentPath 'pythonw.exe'
if (-not (Test-Path -LiteralPath $pythonw)) {
    throw "pythonw.exe was not found in the Conda environment at $environmentPath"
}

$previousErrorActionPreference = $ErrorActionPreference
try {
    $ErrorActionPreference = 'Continue'
    & $CondaExe run -n $EnvironmentName python -m pip install -r $requirements
    $pipExitCode = $LASTEXITCODE
}
finally {
    $ErrorActionPreference = $previousErrorActionPreference
}
if ($pipExitCode -ne 0) {
    throw 'PyWebView installation failed.'
}

$appRoot = 'D:\DevTools\PomodoroLauncher'
$iconPath = Join-Path $repoRoot 'assets\pomodoro-icon.ico'
if (-not (Test-Path -LiteralPath $iconPath)) {
    throw "Pomodoro icon was not found at $iconPath"
}
New-Item -ItemType Directory -Force -Path (Join-Path $appRoot 'data') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $appRoot 'logs') | Out-Null

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop (Get-PomodoroShortcutName)
$entrypoint = Join-Path $PSScriptRoot 'app.pyw'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $pythonw
$shortcut.Arguments = '"' + $entrypoint + '"'
$shortcut.WorkingDirectory = $repoRoot
$shortcut.IconLocation = "$iconPath,0"
$shortcut.Description = 'Pomodoro Paper Workbench'
$shortcut.Save()

Write-Host "Installed desktop shortcut: $shortcutPath"
