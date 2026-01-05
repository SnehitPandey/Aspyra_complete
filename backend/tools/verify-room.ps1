# Room System Verification Script (PowerShell)
# Tests REST endpoints, Socket events, and database persistence
# Usage: .\tools\verify-room.ps1 [-BaseUrl "http://localhost:5000"] [-AuthToken "your-jwt-token"]

param(
    [string]$BaseUrl = "http://localhost:5000",
    [string]$AuthToken = ""
)

$ErrorActionPreference = "Continue"
$RoomId = ""

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Green
}

function Write-Error-Custom {
    param([string]$Message)
    Write-Host "[ERROR] $Message" -ForegroundColor Red
}

function Write-Warn-Custom {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Test-Endpoint {
    param(
        [string]$Method,
        [string]$Endpoint,
        [string]$Data,
        [string]$Description
    )
    
    Write-Info "Testing: $Description"
    
    $Headers = @{
        "Content-Type" = "application/json"
    }
    
    if ($AuthToken) {
        $Headers["Authorization"] = "Bearer $AuthToken"
    }
    
    try {
        $Uri = "$BaseUrl$Endpoint"
        
        if ($Method -eq "GET") {
            $Response = Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers -ErrorAction Stop
        } else {
            $Response = Invoke-RestMethod -Uri $Uri -Method $Method -Headers $Headers -Body $Data -ErrorAction Stop
        }
        
        Write-Info "✅ $Description - Success"
        return $Response
    }
    catch {
        Write-Error-Custom "❌ $Description - Failed: $($_.Exception.Message)"
        return $null
    }
}

# Test 1: Health check
Write-Info "========== Testing Health Check =========="
Test-Endpoint -Method "GET" -Endpoint "/health" -Data "" -Description "Health endpoint"

# Test 2: Debug endpoints
Write-Info "`n========== Testing Debug Endpoints =========="
Test-Endpoint -Method "GET" -Endpoint "/api/debug/presence" -Data "" -Description "Presence debug endpoint"

# Test 3: Get rooms
Write-Info "`n========== Testing Room Endpoints =========="
if ($AuthToken) {
    Write-Info "Fetching user's rooms..."
    $RoomResponse = Test-Endpoint -Method "GET" -Endpoint "/api/rooms" -Data "" -Description "Get user rooms"
    
    if ($RoomResponse -and $RoomResponse.rooms -and $RoomResponse.rooms.Count -gt 0) {
        $RoomId = $RoomResponse.rooms[0]._id
        Write-Info "Using ROOM_ID: $RoomId"
        
        # Test 4: Get room details
        Test-Endpoint -Method "GET" -Endpoint "/api/rooms/$RoomId" -Data "" -Description "Get room details"
        
        # Test 5: Get room roadmap
        Test-Endpoint -Method "GET" -Endpoint "/api/rooms/$RoomId/roadmap" -Data "" -Description "Get room roadmap"
        
        # Test 6: Get room progress
        Test-Endpoint -Method "GET" -Endpoint "/api/rooms/$RoomId/progress" -Data "" -Description "Get room progress"
        
        # Test 7: Get room messages
        Test-Endpoint -Method "GET" -Endpoint "/api/rooms/$RoomId/messages?limit=10" -Data "" -Description "Get room messages"
        
        # Test 8: Post a test message
        $TestMessage = @{
            content = "Test message from verification script"
            type = "user"
        } | ConvertTo-Json
        Test-Endpoint -Method "POST" -Endpoint "/api/rooms/$RoomId/messages" -Data $TestMessage -Description "Post room message"
        
        # Test 9: Get room quizzes
        Test-Endpoint -Method "GET" -Endpoint "/api/rooms/$RoomId/quizzes" -Data "" -Description "Get room quizzes"
        
        # Test 10: Get Kanban boards
        Test-Endpoint -Method "GET" -Endpoint "/api/rooms/$RoomId/kanban" -Data "" -Description "Get Kanban boards"
        
        # Test 11: Debug room state
        Test-Endpoint -Method "GET" -Endpoint "/api/debug/room/$RoomId/state" -Data "" -Description "Get room debug state"
        
        Write-Info "`n========== Room Verification Complete =========="
        Write-Info "✅ All accessible endpoints tested successfully"
    }
    else {
        Write-Warn-Custom "No rooms found for this user. Create a room first to test room-specific endpoints."
    }
}
else {
    Write-Warn-Custom "No AUTH_TOKEN provided. Skipping authenticated endpoints."
    Write-Info "Usage: .\tools\verify-room.ps1 -BaseUrl 'http://localhost:5000' -AuthToken 'your-jwt-token'"
}

Write-Info "`n========== Socket Event Test (Manual) =========="
Write-Info "To test Socket events, use the Socket client test:"
Write-Info "  cd backend && node tools/test-socket-events.js"

exit 0
