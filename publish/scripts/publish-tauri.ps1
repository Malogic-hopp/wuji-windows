#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Publish the WUJI Tauri dev-preview portable package.
.DESCRIPTION
    Builds the Tauri shell and publishes Bridge and Agent as separate
    self-contained win-x64 applications. The package layout is frozen by
    publish/tauri/package-layout.v1.json and is independent from the existing
    WPF publish flow.
#>

[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ContractPath = Join-Path $RepoRoot 'publish\tauri\package-layout.v1.json'
$LayoutGatePath = Join-Path $PSScriptRoot 'test-tauri-package-layout.ps1'
$TauriRoot = Join-Path $RepoRoot 'src\QuantifiedSelf.Windows.Tauri'
$BridgeProject = Join-Path $RepoRoot 'src\QuantifiedSelf.Windows.Client.Bridge\QuantifiedSelf.Windows.Client.Bridge.csproj'
$AgentProject = Join-Path $RepoRoot 'src\QuantifiedSelf.Windows.Agent\QuantifiedSelf.Windows.Agent.csproj'

function Join-ContractPath {
    param(
        [Parameter(Mandatory)][string]$BasePath,
        [Parameter(Mandatory)][string]$RelativePath
    )

    $result = $BasePath
    foreach ($segment in $RelativePath.Split('/')) {
        if ([string]::IsNullOrWhiteSpace($segment) -or $segment -eq '.' -or $segment -eq '..') {
            throw "Package contract contains an unsafe path segment."
        }
        $result = Join-Path $result $segment
    }
    return $result
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory)][string]$FilePath,
        [Parameter(Mandatory)][string[]]$Arguments,
        [Parameter(Mandatory)][string]$FailureMessage
    )

    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "$FailureMessage (exit code $LASTEXITCODE)."
    }
}

function Copy-DirectoryContents {
    param(
        [Parameter(Mandatory)][string]$Source,
        [Parameter(Mandatory)][string]$Destination
    )

    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    Copy-Item -Path (Join-Path $Source '*') -Destination $Destination -Recurse -Force
}

function Write-SafePath {
    param([Parameter(Mandatory)][string]$Label, [Parameter(Mandatory)][string]$Path)
    $repoPrefix = $RepoRoot.TrimEnd('\', '/') + [IO.Path]::DirectorySeparatorChar
    if (-not $Path.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Refusing to display a package path outside the repository.'
    }
    Write-Host ("  {0}: <workspace>/{1}" -f $Label, $Path.Substring($repoPrefix.Length).Replace('\', '/'))
}

$contract = Get-Content -LiteralPath $ContractPath -Encoding UTF8 -Raw | ConvertFrom-Json
if ($contract.schemaVersion -ne 1 -or $contract.packageKind -ne 'dev-preview') {
    throw 'Unsupported Tauri package contract.'
}
if ($contract.channel -ne 'dev') {
    throw 'Stage 7A packages must remain fixed to the dev channel.'
}
if ($contract.runtimeIdentifier -ne 'win-x64' -or $contract.targetTriple -ne 'x86_64-pc-windows-msvc') {
    throw 'Stage 7A supports only win-x64 / x86_64-pc-windows-msvc.'
}

$tauriConfigPath = Join-Path $TauriRoot 'src-tauri\tauri.conf.json'
$tauriConfig = Get-Content -LiteralPath $tauriConfigPath -Encoding UTF8 -Raw | ConvertFrom-Json
$packageJson = Get-Content -LiteralPath (Join-Path $TauriRoot 'package.json') -Encoding UTF8 -Raw | ConvertFrom-Json
[xml]$directoryBuild = Get-Content -LiteralPath (Join-Path $RepoRoot 'Directory.Build.props') -Encoding UTF8 -Raw
$dotnetVersion = [string]$directoryBuild.Project.PropertyGroup.Version

if ($contract.version -ne $tauriConfig.version -or
    $contract.version -ne $packageJson.version -or
    $contract.version -ne $dotnetVersion) {
    throw 'Package, Tauri and .NET versions must match the package layout contract.'
}
if ($contract.tauri.identifier -ne $tauriConfig.identifier -or
    $contract.tauri.productName -ne $tauriConfig.productName) {
    throw 'Tauri identity must match the package layout contract.'
}
if ($tauriConfig.bundle.active -ne $false) {
    throw 'Stage 7A creates a dev-preview portable package; installer bundling must remain disabled.'
}

$packageRoot = Join-ContractPath -BasePath $RepoRoot -RelativePath $contract.output.root
$allowedRoot = [IO.Path]::GetFullPath((Join-Path $RepoRoot 'artifacts\tauri-dev-preview')).TrimEnd('\') + '\'
$packageRoot = [IO.Path]::GetFullPath($packageRoot)
if (-not ($packageRoot + '\').StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Refusing to publish outside artifacts/tauri-dev-preview.'
}

$appDirectory = Join-ContractPath -BasePath $packageRoot -RelativePath $contract.output.appDirectory
$bridgeDirectory = Join-ContractPath -BasePath $appDirectory -RelativePath $contract.layout.bridgeDirectory
$agentDirectory = Join-ContractPath -BasePath $appDirectory -RelativePath $contract.layout.agentDirectory
$bridgeExecutable = Join-ContractPath -BasePath $appDirectory -RelativePath $contract.layout.bridgeExecutable
$agentExecutable = Join-ContractPath -BasePath $appDirectory -RelativePath $contract.layout.agentExecutable
$shellExecutable = Join-Path $appDirectory $contract.tauri.shellExecutableName
$stagingRoot = Join-Path $packageRoot '.staging'
$bridgeStaging = Join-Path $stagingRoot 'bridge'
$agentStaging = Join-Path $stagingRoot 'agent'

Write-Host '=== WUJI Tauri dev-preview publish ==='
Write-Host "  Version: $($contract.version)"
Write-Host "  Channel: $($contract.channel)"
Write-Host "  Runtime: $($contract.runtimeIdentifier)"
Write-Host "  Target:  $($contract.targetTriple)"
Write-SafePath -Label 'Output' -Path $packageRoot

if (Test-Path -LiteralPath $packageRoot) {
    Remove-Item -LiteralPath $packageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $bridgeStaging -Force | Out-Null
New-Item -ItemType Directory -Path $agentStaging -Force | Out-Null

Write-Host "`n--- 1/5 Publish Bridge self-contained ---"
Invoke-ExternalCommand -FilePath 'dotnet' -Arguments @(
    'publish', $BridgeProject,
    '--configuration', $contract.configuration,
    '--runtime', $contract.runtimeIdentifier,
    '--self-contained', 'true',
    '--output', $bridgeStaging,
    '-p:PublishSingleFile=false',
    '-p:PublishReadyToRun=false',
    '-p:DebugType=None',
    '-p:DebugSymbols=false'
) -FailureMessage 'Bridge self-contained publish failed'

Write-Host "`n--- 2/5 Publish Agent self-contained ---"
Invoke-ExternalCommand -FilePath 'dotnet' -Arguments @(
    'publish', $AgentProject,
    '--configuration', $contract.configuration,
    '--runtime', $contract.runtimeIdentifier,
    '--self-contained', 'true',
    '--output', $agentStaging,
    '-p:PublishSingleFile=false',
    '-p:PublishReadyToRun=false',
    '-p:DebugType=None',
    '-p:DebugSymbols=false'
) -FailureMessage 'Agent self-contained publish failed'

Write-Host "`n--- 3/5 Build Tauri shell without installer bundle ---"
$pnpm = (Get-Command 'pnpm.cmd' -ErrorAction Stop).Source
Push-Location $TauriRoot
try {
    Invoke-ExternalCommand -FilePath $pnpm -Arguments @(
        'tauri', 'build', '--no-bundle', '--target', $contract.targetTriple
    ) -FailureMessage 'Tauri release build failed'
}
finally {
    Pop-Location
}

$builtShell = Join-Path $TauriRoot ("src-tauri\target\{0}\release\{1}" -f $contract.targetTriple, $contract.tauri.shellExecutableName)
if (-not (Test-Path -LiteralPath $builtShell -PathType Leaf)) {
    throw 'Tauri shell executable was not found in the target-triple release directory.'
}

Write-Host "`n--- 4/5 Assemble isolated package layout ---"
New-Item -ItemType Directory -Path $appDirectory -Force | Out-Null
Copy-Item -LiteralPath $builtShell -Destination $shellExecutable -Force
Copy-DirectoryContents -Source $bridgeStaging -Destination $bridgeDirectory
Copy-DirectoryContents -Source $agentStaging -Destination $agentDirectory

$originalBridgeExecutable = Join-Path $bridgeDirectory 'QuantifiedSelf.Windows.Client.Bridge.exe'
if (-not (Test-Path -LiteralPath $originalBridgeExecutable -PathType Leaf)) {
    throw 'Published Bridge executable was not found before target-triple rename.'
}
Move-Item -LiteralPath $originalBridgeExecutable -Destination $bridgeExecutable -Force

if (-not (Test-Path -LiteralPath $agentExecutable -PathType Leaf)) {
    throw 'Published Agent executable was not found in the isolated Agent directory.'
}

Remove-Item -LiteralPath $stagingRoot -Recurse -Force
Copy-Item -LiteralPath $ContractPath -Destination (Join-Path $packageRoot $contract.output.contractFile) -Force

$manifest = [ordered]@{
    schemaVersion = 1
    packageKind = $contract.packageKind
    version = $contract.version
    channel = $contract.channel
    configuration = $contract.configuration
    runtimeIdentifier = $contract.runtimeIdentifier
    targetTriple = $contract.targetTriple
    createdAtUtc = [DateTimeOffset]::UtcNow.ToString('O')
    layoutContract = $contract.output.contractFile
    executables = [ordered]@{
        shell = [ordered]@{ path = ("{0}/{1}" -f $contract.output.appDirectory, $contract.tauri.shellExecutableName); sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $shellExecutable).Hash.ToLowerInvariant() }
        bridge = [ordered]@{ path = ("{0}/{1}" -f $contract.output.appDirectory, $contract.layout.bridgeExecutable); sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $bridgeExecutable).Hash.ToLowerInvariant() }
        agent = [ordered]@{ path = ("{0}/{1}" -f $contract.output.appDirectory, $contract.layout.agentExecutable); sha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $agentExecutable).Hash.ToLowerInvariant() }
    }
}
$manifestPath = Join-Path $packageRoot $contract.output.manifestFile
$manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host "`n--- 5/5 Verify package layout contract ---"
& $LayoutGatePath -PackageRoot $packageRoot

Write-Host "`n=== Tauri dev-preview package complete ==="
Write-SafePath -Label 'Package' -Path $packageRoot
