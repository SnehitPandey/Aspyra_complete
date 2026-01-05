/**
 * Quick Endpoint Test
 * Tests Room endpoints with a provided JWT token
 * Usage: node tools/quick-test.js [AUTH_TOKEN]
 */

const AUTH_TOKEN = process.argv[2];
const BASE_URL = 'http://localhost:5000';

if (!AUTH_TOKEN) {
  console.log('\n❌ Please provide an authentication token\n');
  console.log('Usage: node tools/quick-test.js [YOUR_JWT_TOKEN]\n');
  console.log('To get a token:');
  console.log('  1. Login to http://localhost:5173');
  console.log('  2. Open DevTools > Application > Local Storage');
  console.log('  3. Copy the token value\n');
  console.log('Or use: .\\tools\\get-auth-token.ps1\n');
  process.exit(1);
}

async function testEndpoint(method, endpoint, description, body = null) {
  try {
    const options = {
      method,
      headers: {
        'Authorization': `Bearer ${AUTH_TOKEN}`,
        'Content-Type': 'application/json',
      },
    };

    if (body) {
      options.body = JSON.stringify(body);
    }

    const response = await fetch(`${BASE_URL}${endpoint}`, options);
    const data = await response.json();

    if (response.ok) {
      console.log(`✅ ${description}`);
      return { success: true, data };
    } else {
      console.log(`❌ ${description} - ${response.status}: ${data.message || 'Unknown error'}`);
      return { success: false, data };
    }
  } catch (error) {
    console.log(`❌ ${description} - Error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function runTests() {
  console.log('\n🧪 Testing Room System Endpoints\n');
  console.log('=================================\n');

  // Test 1: Get user's rooms
  const roomsResult = await testEndpoint('GET', '/api/rooms', 'Get user rooms');
  
  if (!roomsResult.success || !roomsResult.data.rooms || roomsResult.data.rooms.length === 0) {
    console.log('\n⚠️  No rooms found. Please create or join a room first.\n');
    console.log('Visit http://localhost:5173/app/createroom to create a room.\n');
    return;
  }

  const rooms = roomsResult.data.rooms;
  const firstRoom = rooms[0];
  const roomId = firstRoom._id;

  console.log(`\n📍 Testing with Room: "${firstRoom.title}" (ID: ${roomId})\n`);

  // Test 2: Get room details
  await testEndpoint('GET', `/api/rooms/${roomId}`, 'Get room details');

  // Test 3: Get room roadmap
  await testEndpoint('GET', `/api/rooms/${roomId}/roadmap`, 'Get room roadmap');

  // Test 4: Get room progress
  await testEndpoint('GET', `/api/rooms/${roomId}/progress`, 'Get room progress');

  // Test 5: Get room messages
  await testEndpoint('GET', `/api/rooms/${roomId}/messages?limit=10`, 'Get room messages');

  // Test 6: Post a message
  await testEndpoint('POST', `/api/rooms/${roomId}/messages`, 'Post room message', {
    content: 'Test message from quick-test script! 🚀',
    type: 'user'
  });

  // Test 7: Get quizzes
  await testEndpoint('GET', `/api/rooms/${roomId}/quizzes`, 'Get room quizzes');

  // Test 8: Get Kanban boards
  await testEndpoint('GET', `/api/rooms/${roomId}/kanban`, 'Get Kanban boards');

  // Test 9: Debug room state
  await testEndpoint('GET', `/api/debug/room/${roomId}/state`, 'Get room debug state');

  console.log('\n=================================');
  console.log('\n✨ Testing complete!\n');
  console.log('Next steps:');
  console.log('  - Check MongoDB for the new message');
  console.log('  - Test Socket events: node tools/test-socket-events.js ' + BASE_URL + ' [TOKEN] ' + roomId);
  console.log('  - Test quiz generation, topic completion, etc.\n');
}

runTests();
