$repoDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$cliJs = Join-Path $repoDir "packages/coding-agent/dist/cli.js"

if (-not (Test-Path $cliJs)) {
	Write-Error "pire launcher could not find '$cliJs'. Run 'npm install' and 'npm run build' from the repo root first."
	exit 1
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
	Write-Error "Node.js was not found on PATH. Install Node.js 20+ and try again."
	exit 1
}

& $node.Source $cliJs @args
exit $LASTEXITCODE
