# Room System Testing Workflow
# Step-by-step guide to test all Room features

Write-Host ""
Write-Host "Room System Testing Workflow" -ForegroundColor Cyan
Write-Host "============================" -ForegroundColor Cyan
Write-Host ""

Write-Host "PHASE 1: SMOKE TEST (Already Passed)" -ForegroundColor Green
Write-Host "  - Health endpoint: OK"
Write-Host "  - Debug presence: OK"
Write-Host "  - Server running: OK"
Write-Host ""

Write-Host "PHASE 2: GET AUTHENTICATION TOKEN" -ForegroundColor Yellow
Write-Host "  Option A - Use existing frontend:" -ForegroundColor White
Write-Host "    1. Open http://localhost:5173 in browser"
Write-Host "    2. Login with your credentials"
Write-Host "    3. Open DevTools (F12) and go to Application tab"
Write-Host "    4. Find 'token' or 'auth' key and copy the value"
Write-Host ""
Write-Host "  Option B - Use our login script:" -ForegroundColor White
Write-Host "    .\tools\get-auth-token.ps1 -Email 'your@email.com' -Password 'yourpassword'"
Write-Host ""
Write-Host "  Option C - Use cURL:" -ForegroundColor White
Write-Host @"
    `$body = @{
        email = 'your@email.com'
        password = 'yourpassword'
    } | ConvertTo-Json
    
    `$response = Invoke-RestMethod -Uri http://localhost:5000/api/auth/login ``
        -Method POST -Body `$body -ContentType 'application/json'
    
    $response.token
"@

Write-Host ""
Write-Host ""
Write-Host "PHASE 3: TEST REST ENDPOINTS" -ForegroundColor Yellow
Write-Host "  Once you have a token, run:" -ForegroundColor White
Write-Host "    .\tools\verify-room.ps1 -AuthToken 'your-token-here'" -ForegroundColor Cyan
Write-Host ""
Write-Host "  This will test:" -ForegroundColor White
Write-Host "    ✓ Get user rooms"
Write-Host "    ✓ Get room details"
Write-Host "    ✓ Get room roadmap"
Write-Host "    ✓ Get room progress"
Write-Host "    ✓ Get/Post messages"
Write-Host "    ✓ Get quizzes"
Write-Host "    ✓ Get Kanban boards"
Write-Host "    ✓ Debug room state"

Write-Host ""
Write-Host ""
Write-Host "PHASE 4: TEST SOCKET EVENTS" -ForegroundColor Yellow
Write-Host "  Terminal 1 - Start event listener:" -ForegroundColor White
Write-Host "    node tools/test-socket-events.js http://localhost:5000 [TOKEN] [ROOM_ID]" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Terminal 2 - Trigger events by:" -ForegroundColor White
Write-Host "    - Completing a topic in the room"
Write-Host "    - Sending a message"
Write-Host "    - Generating a quiz"
Write-Host "    - Moving a Kanban task"

Write-Host ""
Write-Host ""
Write-Host "PHASE 5: VERIFY DATABASE" -ForegroundColor Yellow
Write-Host "  Check MongoDB collections updated:" -ForegroundColor White
Write-Host "    - messages[] array populated"
Write-Host "    - quizzes[] array with generated quizzes"
Write-Host "    - progress[] array with user progress"
Write-Host "    - streaks[] array with daily streaks"
Write-Host "    - kanbanBoards[] array with user boards"

Write-Host ""
Write-Host ""
Write-Host "QUICK START (Recommended):" -ForegroundColor Green
Write-Host "================================" -ForegroundColor Green
Write-Host "1. Get token:" -ForegroundColor Yellow
Write-Host "   .\tools\get-auth-token.ps1" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Test endpoints:" -ForegroundColor Yellow
Write-Host "   .\tools\verify-room.ps1 -AuthToken `"`$(Get-Content tools\.token)`"" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Test sockets:" -ForegroundColor Yellow
Write-Host "   node tools/test-socket-events.js http://localhost:5000 (Get-Content tools\.token) [ROOM_ID]" -ForegroundColor Cyan

Write-Host ""
Write-Host ""
Write-Host "Full Documentation:" -ForegroundColor Cyan
Write-Host "  - ROOM_IMPLEMENTATION_COMPLETE.md (implementation details)"
Write-Host "  - TESTING_GUIDE.md (step-by-step testing)"
Write-Host "  - tools/README.md (script usage)"

Write-Host ""
Write-Host "Happy Testing!" -ForegroundColor Green
Write-Host ""
