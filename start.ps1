param([switch]$NoOpen)
$ErrorActionPreference = 'Stop'
$rentalNodeCommand = Get-Command node -ErrorAction SilentlyContinue
$rentalNode = if ($rentalNodeCommand) { $rentalNodeCommand.Source } else { Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe' }
if (-not (Test-Path -LiteralPath $rentalNode)) { throw 'Node.js 20 이상을 설치한 뒤 다시 실행해주세요.' }
$rentalArguments = @((Join-Path $PSScriptRoot 'scripts\start.cjs'))
if ($NoOpen) { $rentalArguments += '--no-open' }
& $rentalNode @rentalArguments
if ($LASTEXITCODE -ne 0) { throw '앱 실행에 실패했습니다. 위 안내를 확인해주세요.' }
