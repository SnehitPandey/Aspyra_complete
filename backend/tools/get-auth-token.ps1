# Get Authentication Token Script
# Helps you login and get a JWT token for testing
# Usage: .\tools\get-auth-token.ps1 -Email "your@email.com" -Password "yourpassword"

param(
    [string]$Email = "",
    [string]$Password = "",
    [string]$BaseUrl = "http://localhost:5000"
)

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

# If no email/password provided, prompt user
if (-not $Email) {
    $Email = Read-Host "Enter your email"
}

if (-not $Password) {
    $Password = Read-Host "Enter your password" -AsSecureString
    $BSTR = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password)
    $Password = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($BSTR)
}

Write-Info "Attempting login to $BaseUrl..."

$Body = @{
    email = $Email
    password = $Password
} | ConvertTo-Json

try {
    $Response = Invoke-RestMethod -Uri "$BaseUrl/api/auth/login" -Method POST -Body $Body -ContentType "application/json"
    
    if ($Response.token) {
        Write-Info "✅ Login successful!"
        Write-Host "`n================================================" -ForegroundColor Cyan
        Write-Host "JWT TOKEN (copy this):" -ForegroundColor Yellow
        Write-Host "`n$($Response.token)`n" -ForegroundColor White
        Write-Host "================================================`n" -ForegroundColor Cyan
        
        Write-Info "User: $($Response.user.name) (@$($Response.user.username))"
        Write-Info "User ID: $($Response.user._id)"
        
        Write-Host "`nTo test endpoints, run:" -ForegroundColor Cyan
        Write-Host ".\tools\verify-room.ps1 -AuthToken `"$($Response.token)`"" -ForegroundColor Yellow
        
        # Save token to file for easy access
        $Response.token | Out-File -FilePath ".\tools\.token" -NoNewline
        Write-Info "`nToken saved to tools\.token for future use"
        
        return $Response.token
    }
    else {
        Write-Error-Custom "Login failed - no token received"
    }
}
catch {
    Write-Error-Custom "Login failed: $($_.Exception.Message)"
    
    if ($_.Exception.Response) {
        $Reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $ResponseBody = $Reader.ReadToEnd()
        Write-Host "`nServer Response: $ResponseBody" -ForegroundColor Red
    }
}
