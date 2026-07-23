@echo off
REM Optional ops backup sample (DOC/03 §8.7). Does NOT replace product cold backup (§8.8).
REM Stop the application before running.
REM
REM Usage:
REM   scripts\ops\backup.example.bat [output-dir]
REM
REM Data root: DATA_DIR | AROUSAL_DATA_DIR | config.yaml dataDir | ./data
REM Archive excludes the dataDir\backups\ subdirectory.

setlocal
echo Stop the app before backup. This is an optional ops sample — see DOC/03 §8.7 / data/README.md.
if "%~1"=="" (
  node "%~dp0backup-data.mjs"
) else (
  node "%~dp0backup-data.mjs" "%~1"
)
exit /b %ERRORLEVEL%
