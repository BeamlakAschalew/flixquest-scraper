/**
 * Test script to verify the API endpoints work correctly
 * Run with: node --loader tsx test.ts
 * Or: tsx test.ts
 */

import "dotenv/config";

const BASE_URL = "http://localhost:3000";

async function testEndpoint(
  name: string,
  url: string
): Promise<{ success: boolean; data?: any; error?: string }> {
  console.log(`\n🧪 Testing: ${name}`);
  console.log(`📍 URL: ${url}`);

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (response.ok) {
      console.log(`✅ Success`);
      console.log(`📦 Response:`, JSON.stringify(data, null, 2));
      return { success: true, data };
    } else {
      console.log(`❌ Failed with status: ${response.status}`);
      console.log(`📦 Response:`, JSON.stringify(data, null, 2));
      return { success: false, error: data.error };
    }
  } catch (error) {
    console.log(`❌ Error:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function runTests() {
  console.log("🚀 FlixQuest Scraper API Tests");
  console.log("================================\n");

  // Check if server is running
  console.log("🔍 Checking if server is running...");
  try {
    await fetch(BASE_URL);
    console.log("✅ Server is running");
  } catch (error) {
    console.log("❌ Server is not running!");
    console.log("Please start the server first with: pnpm dev or pnpm start");
    process.exit(1);
  }

  // Test 1: Health check
  await testEndpoint("Health Check", `${BASE_URL}/`);

  // Test 2: List sources
  await testEndpoint("List Sources", `${BASE_URL}/sources`);

  // Test 3: List embeds
  await testEndpoint("List Embeds", `${BASE_URL}/embeds`);

  // Test 4: Stream movie (Hamilton)
  await testEndpoint(
    "Stream Movie - Hamilton",
    `${BASE_URL}/stream-movie?tmdbId=556574`
  );

  // Test 5: Stream TV show (The Office S1E1)
  await testEndpoint(
    "Stream TV Show - The Office S1E1",
    `${BASE_URL}/stream-tv?tmdbId=2316&season=1&episode=1`
  );

  // Test 6: Error handling - missing tmdbId
  await testEndpoint("Error Test - Missing tmdbId", `${BASE_URL}/stream-movie`);

  // Test 7: Error handling - invalid episode
  await testEndpoint(
    "Error Test - Invalid Episode",
    `${BASE_URL}/stream-tv?tmdbId=2316&season=1&episode=999`
  );

  console.log("\n================================");
  console.log("✨ Tests completed!");
  console.log("\nNote: Some tests may fail if:");
  console.log("  - TMDB_API_KEY is not set");
  console.log("  - Content is not available on scrapers");
  console.log("  - Network issues occur");
}

// Run tests
runTests().catch(console.error);
