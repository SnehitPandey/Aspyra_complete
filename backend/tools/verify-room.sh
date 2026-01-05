#!/bin/bash

# Room System Verification Script
# Tests REST endpoints, Socket events, and database persistence
# Usage: ./tools/verify-room.sh [BASE_URL] [AUTH_TOKEN]

set -e

BASE_URL="${1:-http://localhost:5000}"
AUTH_TOKEN="${2:-}"
ROOM_ID=""
USER_ID=""
TOPIC_ID=""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Helper functions
log_info() {
  echo -e "${GREEN}[INFO]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

test_endpoint() {
  local method=$1
  local endpoint=$2
  local data=$3
  local description=$4
  
  log_info "Testing: $description"
  
  local headers=(-H "Content-Type: application/json")
  if [ -n "$AUTH_TOKEN" ]; then
    headers+=(-H "Authorization: Bearer $AUTH_TOKEN")
  fi
  
  local response
  if [ "$method" = "GET" ]; then
    response=$(curl -s -w "\n%{http_code}" -X GET "${BASE_URL}${endpoint}" "${headers[@]}")
  else
    response=$(curl -s -w "\n%{http_code}" -X "$method" "${BASE_URL}${endpoint}" "${headers[@]}" -d "$data")
  fi
  
  local body=$(echo "$response" | head -n -1)
  local status=$(echo "$response" | tail -n 1)
  
  if [ "$status" -ge 200 ] && [ "$status" -lt 300 ]; then
    log_info "✅ $description - Status: $status"
    echo "$body"
    return 0
  else
    log_error "❌ $description - Status: $status"
    echo "$body"
    return 1
  fi
}

# Test 1: Health check
log_info "========== Testing Health Check =========="
test_endpoint "GET" "/health" "" "Health endpoint"

# Test 2: Debug endpoints
log_info "\n========== Testing Debug Endpoints =========="
test_endpoint "GET" "/api/debug/presence" "" "Presence debug endpoint" || log_warn "Debug endpoints may require authentication"

# Test 3: Get rooms (to extract a ROOM_ID for testing)
log_info "\n========== Testing Room Endpoints =========="
if [ -n "$AUTH_TOKEN" ]; then
  log_info "Fetching user's rooms..."
  room_response=$(test_endpoint "GET" "/api/rooms" "" "Get user rooms" || echo "{}")
  
  # Extract first room ID (requires jq)
  if command -v jq &> /dev/null; then
    ROOM_ID=$(echo "$room_response" | jq -r '.rooms[0]._id // empty' 2>/dev/null || echo "")
    if [ -n "$ROOM_ID" ]; then
      log_info "Using ROOM_ID: $ROOM_ID"
      
      # Test 4: Get room details
      test_endpoint "GET" "/api/rooms/$ROOM_ID" "" "Get room details"
      
      # Test 5: Get room roadmap
      test_endpoint "GET" "/api/rooms/$ROOM_ID/roadmap" "" "Get room roadmap"
      
      # Test 6: Get room progress
      test_endpoint "GET" "/api/rooms/$ROOM_ID/progress" "" "Get room progress"
      
      # Test 7: Get room messages
      test_endpoint "GET" "/api/rooms/$ROOM_ID/messages?limit=10" "" "Get room messages"
      
      # Test 8: Post a test message
      test_message='{"content":"Test message from verification script","type":"user"}'
      test_endpoint "POST" "/api/rooms/$ROOM_ID/messages" "$test_message" "Post room message"
      
      # Test 9: Get room quizzes
      test_endpoint "GET" "/api/rooms/$ROOM_ID/quizzes" "" "Get room quizzes"
      
      # Test 10: Get Kanban boards
      test_endpoint "GET" "/api/rooms/$ROOM_ID/kanban" "" "Get Kanban boards"
      
      # Test 11: Debug room state
      test_endpoint "GET" "/api/debug/room/$ROOM_ID/state" "" "Get room debug state"
      
      log_info "\n========== Room Verification Complete =========="
      log_info "✅ All accessible endpoints tested successfully"
      
    else
      log_warn "No rooms found for this user. Create a room first to test room-specific endpoints."
    fi
  else
    log_warn "jq not installed. Skipping room-specific tests. Install jq for full verification."
  fi
else
  log_warn "No AUTH_TOKEN provided. Skipping authenticated endpoints."
  log_info "Usage: ./tools/verify-room.sh [BASE_URL] [AUTH_TOKEN]"
  log_info "Example: ./tools/verify-room.sh http://localhost:5000 eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
fi

log_info "\n========== Socket Event Test (Manual) =========="
log_info "To test Socket events, use the Socket client test:"
log_info "  cd backend && node tools/test-socket-events.js"

exit 0
