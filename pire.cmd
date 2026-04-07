@echo off
setlocal

set "REPO_DIR=%~dp0"
set "CLI_JS=%REPO_DIR%packages\coding-agent\dist\cli.js"

if not exist "%CLI_JS%" (
	echo pire launcher could not find "%CLI_JS%".
	echo Run "npm install" and "npm run build" from the repo root first.
	exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
	echo Node.js was not found on PATH.
	echo Install Node.js 20+ and try again.
	exit /b 1
)

node "%CLI_JS%" %*
