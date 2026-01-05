/**
 * Socket Event Verification Script
 * Tests real-time Socket.IO events for Room system
 * Usage: node tools/test-socket-events.js [SERVER_URL] [AUTH_TOKEN] [ROOM_ID]
 */

import { io } from 'socket.io-client';

const SERVER_URL = process.argv[2] || 'http://localhost:5000';
const AUTH_TOKEN = process.argv[3] || '';
const ROOM_ID = process.argv[4] || '';

if (!AUTH_TOKEN) {
  console.error('❌ AUTH_TOKEN required');
  console.log('Usage: node tools/test-socket-events.js [SERVER_URL] [AUTH_TOKEN] [ROOM_ID]');
  process.exit(1);
}

if (!ROOM_ID) {
  console.error('❌ ROOM_ID required');
  console.log('Usage: node tools/test-socket-events.js [SERVER_URL] [AUTH_TOKEN] [ROOM_ID]');
  process.exit(1);
}

console.log(`\n🔌 Connecting to ${SERVER_URL}...`);

const socket = io(SERVER_URL, {
  auth: {
    token: AUTH_TOKEN,
  },
  transports: ['websocket'],
});

let testsCompleted = 0;
const totalTests = 6;

function logSuccess(message) {
  console.log(`✅ ${message}`);
  testsCompleted++;
  if (testsCompleted >= totalTests) {
    console.log(`\n✅ All ${totalTests} socket event tests passed!`);
    setTimeout(() => {
      socket.disconnect();
      process.exit(0);
    }, 1000);
  }
}

function logError(message) {
  console.error(`❌ ${message}`);
  socket.disconnect();
  process.exit(1);
}

// Test 1: Connection
socket.on('connect', () => {
  logSuccess('Socket connected');
  
  // Test 2: Join room
  console.log(`\n📍 Joining room: ${ROOM_ID}`);
  socket.emit('room:join', { roomId: ROOM_ID });
});

socket.on('connect_error', (error) => {
  logError(`Connection error: ${error.message}`);
});

// Test 3: Listen for room:topic:complete event
socket.on('room:topic:complete', (data) => {
  logSuccess(`Received room:topic:complete event: ${JSON.stringify(data)}`);
});

// Test 4: Listen for room:message:new event
socket.on('room:message:new', (data) => {
  logSuccess(`Received room:message:new event: ${JSON.stringify(data)}`);
});

// Test 5: Listen for room:progress:update event
socket.on('room:progress:update', (data) => {
  logSuccess(`Received room:progress:update event: ${JSON.stringify(data)}`);
});

// Test 6: Listen for room:quiz:new event
socket.on('room:quiz:new', (data) => {
  logSuccess(`Received room:quiz:new event: ${JSON.stringify(data)}`);
});

// Test 7: Listen for room:kanban:update event
socket.on('room:kanban:update', (data) => {
  logSuccess(`Received room:kanban:update event: ${JSON.stringify(data)}`);
});

// Setup timeout
setTimeout(() => {
  if (testsCompleted === 0) {
    console.log('\n⚠️  No events received in 10 seconds.');
    console.log('This is expected if no room activity is happening.');
    console.log('To test events:');
    console.log('  1. Complete a topic in the room');
    console.log('  2. Send a message');
    console.log('  3. Generate a quiz');
    console.log('  4. Move a Kanban task');
    console.log('\nSocket connection is working. Disconnecting...');
    socket.disconnect();
    process.exit(0);
  }
}, 10000);

console.log('\n👂 Listening for room events...');
console.log('Waiting for:');
console.log('  - room:topic:complete');
console.log('  - room:message:new');
console.log('  - room:progress:update');
console.log('  - room:quiz:new');
console.log('  - room:kanban:update');
console.log('\nPerform actions in the room to trigger these events...\n');
