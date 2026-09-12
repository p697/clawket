param(
  [ValidateSet('Install','Start','Stop','Status','Uninstall')][string]$Action = 'Status',
  [Parameter(Mandatory=$true)][string]$ConfigPath,
  [string]$CliPath,
  [string]$NodePath
)
$ErrorActionPreference = 'Stop'
$configFile = (Resolve-Path -LiteralPath $ConfigPath).Path
$serviceDirectory = Join-Path (Split-Path $configFile) 'windows-service'
$manifestPath = Join-Path $serviceDirectory 'installation.json'
$supervisor = Join-Path $serviceDirectory 'local-model-supervisor.mjs'
$keyBytes = [Text.Encoding]::UTF8.GetBytes($configFile.ToLowerInvariant())
$keyHash = ([BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($keyBytes))).Replace('-','').Substring(0,24)
$runName = "ClawketLocalModelPreview-$keyHash"
$runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
if ($Action -eq 'Install') {
  if (Test-Path -LiteralPath $manifestPath) {
    $previous = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($previous.config -and $previous.config -ne $configFile) { throw 'Use a separate directory for each local-model configuration' }
  }
  $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
  if (-not $config.relay.relaySecret) { throw 'An existing paired local-model config is required' }
  if (-not $NodePath) { $NodePath = (Get-Command node -ErrorAction Stop).Source }
  if (-not $CliPath) { $CliPath = Join-Path $PSScriptRoot '../../apps/bridge-cli/dist/index.js' }
  $NodePath = (Resolve-Path -LiteralPath $NodePath).Path
  $CliPath = (Resolve-Path -LiteralPath $CliPath).Path
  New-Item -ItemType Directory -Path $serviceDirectory -Force | Out-Null
  $release = Join-Path $serviceDirectory ('releases/' + (Get-FileHash -LiteralPath $CliPath -Algorithm SHA256).Hash.Substring(0,16))
  New-Item -ItemType Directory -Path $release -Force | Out-Null
  $installedCli = Join-Path $release 'index.mjs'
  Copy-Item -LiteralPath $CliPath -Destination $installedCli -Force
  # The CLI bundle intentionally keeps four npm dependencies external. Pin the
  # installed versions and install into this snapshot, independent of checkout.
  $dependencyScript = @'
const {createRequire} = require('node:module');
const {writeFileSync} = require('node:fs');
const {join} = require('node:path');
const source = createRequire(process.argv[1]);
const dependencies = Object.fromEntries(['ws','qrcode','qrcode-terminal','tweetnacl'].map(name => [name, source(name + '/package.json').version]));
writeFileSync(join(process.argv[2], 'package.json'), JSON.stringify({private:true, dependencies}));
'@
  & $NodePath -e $dependencyScript $CliPath $release
  if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve CLI dependencies; installation not activated' }
  & (Join-Path (Split-Path $NodePath) 'npm.cmd') install --prefix $release --ignore-scripts --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'Cannot install CLI dependencies; installation not activated' }
  # Immutable bundle snapshots permit rollback; pairing and history stay in place.
  if (Test-Path -LiteralPath $manifestPath) {
    Copy-Item -LiteralPath $manifestPath -Destination ($manifestPath + '.previous') -Force
  }
  if (Test-Path -LiteralPath $supervisor) { Copy-Item -LiteralPath $supervisor -Destination ($supervisor + '.previous') -Force }
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'local-model-supervisor.mjs') -Destination $supervisor -Force
  [IO.File]::WriteAllText($manifestPath, (@{ node=$NodePath; cli=$installedCli; config=$configFile } | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
  $command = '"' + $NodePath + '" "' + $supervisor + '" run "' + $configFile + '"'
  $vbs = 'CreateObject("WScript.Shell").Run "' + $command.Replace('"','""') + '", 0, False'
  $startup = Join-Path $serviceDirectory 'start.vbs'
  Set-Content -LiteralPath $startup -Value $vbs -Encoding Unicode
  New-Item -Path $runKey -Force | Out-Null
  New-ItemProperty -Path $runKey -Name $runName -Value ('wscript.exe "' + $startup + '"') -PropertyType String -Force | Out-Null
  Write-Output 'Installed per-user logon recovery; existing credentials preserved. Run Start to launch.'
  exit 0
}
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'Install this config first' }
$installed = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if ($Action -eq 'Uninstall') {
  & $installed.node $supervisor stop $configFile
  Remove-ItemProperty -Path $runKey -Name $runName -ErrorAction SilentlyContinue
  Write-Output 'Logon recovery removed. Configuration, history and rollback bundles preserved.'
} else {
  & $installed.node $supervisor $Action.ToLowerInvariant() $configFile
  exit $LASTEXITCODE
}
