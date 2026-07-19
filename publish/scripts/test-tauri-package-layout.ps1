#!/usr/bin/env pwsh
<#
.SYNOPSIS
    Validate the frozen WUJI Tauri dev-preview package layout.
#>

[CmdletBinding()]
param(
    [string]$PackageRoot
)

$ErrorActionPreference = 'Stop'
$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$ContractPath = Join-Path $RepoRoot 'publish\tauri\package-layout.v1.json'
$contract = Get-Content -LiteralPath $ContractPath -Encoding UTF8 -Raw | ConvertFrom-Json

function Join-ContractPath {
    param(
        [Parameter(Mandatory)][string]$BasePath,
        [Parameter(Mandatory)][string]$RelativePath
    )

    $result = $BasePath
    foreach ($segment in $RelativePath.Split('/')) {
        if ([string]::IsNullOrWhiteSpace($segment) -or $segment -eq '.' -or $segment -eq '..') {
            throw 'Package contract contains an unsafe path segment.'
        }
        $result = Join-Path $result $segment
    }
    return $result
}

function Assert-FileExists {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Label)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "$Label is missing from the package."
    }
}

function Assert-DirectoryExists {
    param([Parameter(Mandatory)][string]$Path, [Parameter(Mandatory)][string]$Label)
    if (-not (Test-Path -LiteralPath $Path -PathType Container)) {
        throw "$Label directory is missing from the package."
    }
}

function Get-PeSubsystem {
    param([Parameter(Mandatory)][string]$Path)

    $bytes = [IO.File]::ReadAllBytes($Path)
    if ($bytes.Length -lt 256 -or $bytes[0] -ne 0x4d -or $bytes[1] -ne 0x5a) {
        throw 'Tauri shell is not a valid PE executable.'
    }

    $peOffset = [BitConverter]::ToInt32($bytes, 0x3c)
    $optionalHeaderOffset = $peOffset + 24
    if ($optionalHeaderOffset -lt 0 -or $optionalHeaderOffset + 70 -gt $bytes.Length) {
        throw 'Tauri shell PE optional header is invalid.'
    }
    if ($bytes[$peOffset] -ne 0x50 -or $bytes[$peOffset + 1] -ne 0x45) {
        throw 'Tauri shell PE signature is invalid.'
    }

    return [BitConverter]::ToUInt16($bytes, $optionalHeaderOffset + 68)
}

if ([string]::IsNullOrWhiteSpace($PackageRoot)) {
    $PackageRoot = Join-ContractPath -BasePath $RepoRoot -RelativePath $contract.output.root
}
$PackageRoot = [IO.Path]::GetFullPath($PackageRoot)

$appDirectory = Join-ContractPath -BasePath $PackageRoot -RelativePath $contract.output.appDirectory
$bridgeDirectory = Join-ContractPath -BasePath $appDirectory -RelativePath $contract.layout.bridgeDirectory
$agentDirectory = Join-ContractPath -BasePath $appDirectory -RelativePath $contract.layout.agentDirectory
$shellExecutable = Join-Path $appDirectory $contract.tauri.shellExecutableName
$bridgeExecutable = Join-ContractPath -BasePath $appDirectory -RelativePath $contract.layout.bridgeExecutable
$agentExecutable = Join-ContractPath -BasePath $appDirectory -RelativePath $contract.layout.agentExecutable
$manifestPath = Join-Path $PackageRoot $contract.output.manifestFile
$packagedContractPath = Join-Path $PackageRoot $contract.output.contractFile

Assert-DirectoryExists -Path $appDirectory -Label 'App'
Assert-DirectoryExists -Path $bridgeDirectory -Label 'Bridge'
Assert-DirectoryExists -Path $agentDirectory -Label 'Agent'
Assert-FileExists -Path $shellExecutable -Label 'Tauri shell executable'
Assert-FileExists -Path $bridgeExecutable -Label 'Target-triple Bridge executable'
Assert-FileExists -Path $agentExecutable -Label 'Agent executable'
Assert-FileExists -Path $manifestPath -Label 'Package manifest'
Assert-FileExists -Path $packagedContractPath -Label 'Packaged layout contract'

$shellSubsystem = Get-PeSubsystem -Path $shellExecutable
if ($shellSubsystem -ne 2) {
    throw "Packaged Tauri shell must use Windows GUI subsystem 2; actual=$shellSubsystem."
}

if ((Get-FileHash -Algorithm SHA256 -LiteralPath $ContractPath).Hash -ne
    (Get-FileHash -Algorithm SHA256 -LiteralPath $packagedContractPath).Hash) {
    throw 'Packaged layout contract does not match the repository contract.'
}

foreach ($directory in @($bridgeDirectory, $agentDirectory)) {
    foreach ($runtimeFile in @('coreclr.dll', 'hostfxr.dll', 'hostpolicy.dll', 'System.Private.CoreLib.dll')) {
        Assert-FileExists -Path (Join-Path $directory $runtimeFile) -Label "Self-contained runtime file $runtimeFile"
    }
}

Assert-FileExists -Path (Join-Path $bridgeDirectory 'QuantifiedSelf.Windows.Client.Bridge.deps.json') -Label 'Bridge deps.json'
Assert-FileExists -Path (Join-Path $bridgeDirectory 'QuantifiedSelf.Windows.Client.Bridge.runtimeconfig.json') -Label 'Bridge runtimeconfig.json'
Assert-FileExists -Path (Join-Path $agentDirectory 'QuantifiedSelf.Windows.Agent.deps.json') -Label 'Agent deps.json'
Assert-FileExists -Path (Join-Path $agentDirectory 'QuantifiedSelf.Windows.Agent.runtimeconfig.json') -Label 'Agent runtimeconfig.json'

if (Test-Path -LiteralPath (Join-Path $bridgeDirectory 'QuantifiedSelf.Windows.Client.Bridge.exe')) {
    throw 'Bridge executable must use the frozen target-triple file name.'
}
if (Test-Path -LiteralPath (Join-Path $appDirectory 'QuantifiedSelf.Windows.Client.Bridge.exe')) {
    throw 'Bridge artifacts must not be flattened into the app root.'
}
if (Test-Path -LiteralPath (Join-Path $appDirectory 'QuantifiedSelf.Windows.Agent.exe')) {
    throw 'Agent artifacts must not be flattened into the app root.'
}
if (Test-Path -LiteralPath (Join-Path $bridgeDirectory 'QuantifiedSelf.Windows.Agent.exe')) {
    throw 'Agent artifacts must remain isolated under bridge/Agent.'
}
if (Get-ChildItem -LiteralPath $appDirectory -Recurse -Filter 'QuantifiedSelf.Windows.App.exe' -File -ErrorAction SilentlyContinue) {
    throw 'The independent Tauri package must not contain the WPF executable.'
}
if (Get-ChildItem -LiteralPath $appDirectory -Recurse -Filter '*.pdb' -File -ErrorAction SilentlyContinue) {
    throw 'Release package must not contain debug symbol files.'
}

$manifest = Get-Content -LiteralPath $manifestPath -Encoding UTF8 -Raw | ConvertFrom-Json
foreach ($name in @('schemaVersion', 'packageKind', 'version', 'channel', 'configuration', 'runtimeIdentifier', 'targetTriple')) {
    if ($manifest.$name -ne $contract.$name) {
        throw "Package manifest field '$name' does not match the contract."
    }
}
if ($manifest.channel -ne 'dev') {
    throw 'Stage 7A package channel must remain dev.'
}

$hashChecks = @(
    @{ Name = 'shell'; Path = $shellExecutable },
    @{ Name = 'bridge'; Path = $bridgeExecutable },
    @{ Name = 'agent'; Path = $agentExecutable }
)
foreach ($check in $hashChecks) {
    $expected = [string]$manifest.executables.($check.Name).sha256
    $actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $check.Path).Hash.ToLowerInvariant()
    if ($expected -ne $actual) {
        throw "Package manifest hash for $($check.Name) does not match."
    }
}

Write-Host '[PASS] Tauri package identity and dev channel contract'
Write-Host '[PASS] Tauri shell uses Windows GUI subsystem without a console'
Write-Host '[PASS] Bridge and Agent self-contained runtimes'
Write-Host '[PASS] Bridge/Agent isolated directory layout'
Write-Host '[PASS] Target-triple Bridge executable naming'
Write-Host '[PASS] Manifest executable hashes and WPF exclusion'
