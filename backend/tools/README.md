# Room System Testing Tools

This directory contains verification and testing scripts for the Room system implementation.

## Scripts Overview

### 1. `smoke-test.js` - Quick Health Check ✅
**Purpose:** Verify server is running and responding  
**Auth Required:** No  
**Usage:**
```bash
node tools/smoke-test.js [SERVER_URL]
```

**Example:**
```bash
cd backend
node tools/smoke-test.js http://localhost:5000
```

**Tests:**
- Health endpoint responds
- Debug presence endpoint exists
- Rooms endpoint exists (returns 401 without auth)

**Output:**
```
✅ Health endpoint - Status: 200
✅ Debug presence endpoint - Status: 401
✅ Rooms endpoint (requires auth) - Status: 401
3/3 smoke tests passed
```

---

### 2. `verify-room.ps1` - Full REST API Verification (Windows)
**Purpose:** Test all 13 Room endpoints with authentication  
**Auth Required:** Yes  
**Usage:**
```powershell
.\tools\verify-room.ps1 -BaseUrl "http://localhost:5000" -AuthToken "your-jwt-token"
```

**Example:**
```powershell
$token = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
.\tools\verify-room.ps1 -AuthToken $token
```

**Tests:**
- Get user rooms
- Get room details
- Get roadmap
- Get progress
- Get/Post messages
- Get quizzes
- Get Kanban boards
- Debug room state

**Requirements:**
- PowerShell 5.1+
- Valid JWT token
- User must be member of at least one room

---

### 3. `verify-room.sh` - Full REST API Verification (Linux/Mac)
**Purpose:** Same as verify-room.ps1 but for Unix systems  
**Auth Required:** Yes  
**Usage:**
```bash
./tools/verify-room.sh [BASE_URL] [AUTH_TOKEN]
```

**Example:**
```bash
chmod +x tools/verify-room.sh
./tools/verify-room.sh http://localhost:5000 "your-jwt-token"
```

**Requirements:**
- bash
- curl
- jq (optional, for better parsing)

---

### 4. `test-socket-events.js` - Real-time Event Verification
**Purpose:** Test Socket.IO events fire correctly  
**Auth Required:** Yes  
**Usage:**
```bash
node tools/test-socket-events.js [SERVER_URL] [AUTH_TOKEN] [ROOM_ID]
```

**Example:**
```bash
node tools/test-socket-events.js http://localhost:5000 "your-token" "67890abcdef"
```

**Monitors Events:**
- `room:topic:complete`
- `room:message:new`
- `room:progress:update`
- `room:quiz:new`
- `room:kanban:update`

**How to Test:**
1. Run the script in one terminal
2. In another window/browser:
   - Complete a topic
   - Send a message
   - Generate a quiz
   - Move a Kanban task
3. Watch events appear in real-time

**Expected Output:**
```
✅ Socket connected
👂 Listening for room events...
✅ Received room:message:new event: {...}
✅ Received room:topic:complete event: {...}
```

---

## Recommended Testing Flow

### Step 1: Basic Health
```bash
node tools/smoke-test.js
```
✅ Confirms server is running

### Step 2: Get Authentication
**Option A - Via API:**
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"your-password"}'
```

**Option B - From Frontend:**
- Open DevTools > Application > Local Storage
- Copy JWT token value

### Step 3: REST Endpoint Verification
```powershell
# Windows
.\tools\verify-room.ps1 -AuthToken "your-token"
```

```bash
# Linux/Mac
./tools/verify-room.sh http://localhost:5000 "your-token"
```

✅ Confirms all 13 endpoints respond correctly

### Step 4: Socket Event Verification
```bash
# Terminal 1: Start listener
node tools/test-socket-events.js http://localhost:5000 "your-token" "your-room-id"

# Terminal 2: Trigger events
curl -X POST http://localhost:5000/api/rooms/:roomId/messages \
  -H "Authorization: Bearer your-token" \
  -H "Content-Type: application/json" \
  -d '{"content":"Test","type":"user"}'
```

✅ Confirms real-time events work

---

## Troubleshooting

### Error: "Cannot find module"
**Solution:** Run from `backend/` directory
```bash
cd backend
node tools/smoke-test.js
```

### Error: "401 Unauthorized"
**Solution:** Check your JWT token is valid and not expired
```bash
# Get new token
curl -X POST http://localhost:5000/api/auth/login ...
```

### Error: "Connection refused"
**Solution:** Start the dev server
```bash
cd backend
npm run dev
```

### Error: "Room not found"
**Solution:** Ensure you're a member of the room
```bash
# Join room first
curl -X POST http://localhost:5000/api/rooms/:roomId/join \
  -H "Authorization: Bearer your-token"
```

### Error: "Socket connection failed"
**Solution:** Check server logs for Socket.IO initialization
```bash
# Should see: ✅ Socket.IO initialized
npm run dev
```

---

## Adding New Tests

### For REST Endpoints
Edit `verify-room.ps1` or `verify-room.sh` and add:
```bash
test_endpoint "GET" "/api/your/new/endpoint" "" "Your test description"
```

### For Socket Events
Edit `test-socket-events.js` and add:
```javascript
socket.on('your:new:event', (data) => {
  logSuccess(`Received your:new:event: ${JSON.stringify(data)}`);
});
```

---

## CI/CD Integration

### GitHub Actions Example
```yaml
- name: Run Room System Tests
  run: |
    cd backend
    npm run dev &
    sleep 5
    node tools/smoke-test.js
    # Add authenticated tests here
```

### Pre-commit Hook
```bash
#!/bin/bash
cd backend
node tools/smoke-test.js || exit 1
```

---

## Performance Benchmarks

### Expected Response Times
- `/health` - < 50ms
- `/api/rooms` - < 200ms
- `/api/rooms/:id/messages` - < 300ms
- `/api/rooms/:id/quizzes/generate` - 2-5s (AI generation)

### Socket Event Latency
- Same server: < 50ms
- Local network: < 100ms
- Internet: < 500ms

---

**Last Updated:** November 7, 2025  
**Maintainer:** Room System Team  
**Status:** ✅ All tools functional and tested
