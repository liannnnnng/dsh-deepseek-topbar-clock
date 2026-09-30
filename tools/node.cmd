@echo off
REM Resolve the Node executable used by DSH Desktop (bundled runtime first,
REM then the user's PATH), so tools work without any global Node install.
set "BUNDLED=D:\Program Files\DSH Desktop\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
if exist "%BUNDLED%" (
  "%BUNDLED%" %*
) else (
  node %*
)