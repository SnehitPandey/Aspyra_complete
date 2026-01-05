/**
 * Quick Smoke Test for Room System
 * Tests that the server is running and basic endpoints respond
 * Usage: node tools/smoke-test.js [SERVER_URL]
 */

const SERVER_URL = process.argv[2] || 'http://localhost:5000';

async function testEndpoint(method, endpoint, description) {
  try {
    const url = `${SERVER_URL}${endpoint}`;
    const response = await fetch(url, { method });
    const status = response.status;
    
    if (status === 200 || status === 401) {
      // 401 is expected for authenticated endpoints
      console.log(`✅ ${description} - Status: ${status}`);
      return true;
    } else {
      console.error(`❌ ${description} - Status: ${status}`);
      return false;
    }
  } catch (error) {
    console.error(`❌ ${description} - Error: ${error.message}`);
    return false;
  }
}

async function runSmokeTests() {
  console.log(`\n🔥 Running smoke tests against ${SERVER_URL}\n`);
  
  const tests = [
    { method: 'GET', endpoint: '/health', description: 'Health endpoint' },
    { method: 'GET', endpoint: '/api/debug/presence', description: 'Debug presence endpoint' },
    { method: 'GET', endpoint: '/api/rooms', description: 'Rooms endpoint (requires auth)' },
  ];
  
  let passed = 0;
  for (const test of tests) {
    const result = await testEndpoint(test.method, test.endpoint, test.description);
    if (result) passed++;
  }
  
  console.log(`\n${passed}/${tests.length} smoke tests passed`);
  
  if (passed === tests.length) {
    console.log('✅ Server is responding correctly\n');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed\n');
    process.exit(1);
  }
}

runSmokeTests();
