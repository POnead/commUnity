param(
  [Parameter(Mandatory = $true)]
  [string]$Email
)

$securePassword = Read-Host "New administrator password" -AsSecureString
$secureConfirmation = Read-Host "Confirm new administrator password" -AsSecureString

try {
  $password = [Net.NetworkCredential]::new("", $securePassword).Password
  $confirmation = [Net.NetworkCredential]::new("", $secureConfirmation).Password
  if ($password -ne $confirmation) {
    throw "Passwords do not match."
  }

  $env:RESET_ADMIN_EMAIL = $Email
  $env:RESET_ADMIN_PASSWORD = $password
  npm run admin:reset-password
  if ($LASTEXITCODE -ne 0) {
    throw "The administrator password reset command failed."
  }
} finally {
  Remove-Item Env:RESET_ADMIN_EMAIL, Env:RESET_ADMIN_PASSWORD -ErrorAction SilentlyContinue
  $securePassword.Dispose()
  $secureConfirmation.Dispose()
  Remove-Variable password, confirmation -ErrorAction SilentlyContinue
}
