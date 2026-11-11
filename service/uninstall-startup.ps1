# Stops Social Publisher from starting at login. Does not stop a copy that is running now.
$shortcutPath = Join-Path ([Environment]::GetFolderPath("Startup")) "Social Publisher.lnk"
if (Test-Path $shortcutPath) {
    Remove-Item $shortcutPath
    Write-Output "Removed $shortcutPath"
} else {
    Write-Output "Social Publisher was not set to start at login."
}
