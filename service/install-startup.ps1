# Makes Social Publisher start (hidden) every time you log in to Windows.
# It adds a shortcut to your own Startup folder: no admin rights, and nothing else on the laptop changes.
# Undo with: npm run service:uninstall
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "Social Publisher.lnk"

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = (Get-Command powershell.exe).Source
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$root\service\start.ps1`""
$shortcut.WorkingDirectory = $root
$shortcut.WindowStyle = 7  # minimized
$shortcut.Description = "Starts the Social Publisher background service"
$shortcut.Save()

Write-Output "Added $shortcutPath"
Write-Output "Social Publisher will start at your next login. To start it now: npm run service:start"
