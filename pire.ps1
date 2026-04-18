$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$CliPath = Join-Path $ScriptDir "packages/coding-agent/dist/pire.js"
node $CliPath @args
