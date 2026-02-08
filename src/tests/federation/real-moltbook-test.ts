/**
 * Real Moltbook API Connection Test
 *
 * Tests actual Moltbook API connectivity using real credentials.
 */

import { MoltbookClient, MoltbookAPIError } from "../../federation/moltbook/client.js";

const API_KEY = "moltbook_sk_CvHohXhJzYZv7Pyrv3PymLgXnCJ0_e7k";

interface TestResult {
  test: string;
  success: boolean;
  error?: string;
  data?: any;
}

async function testRawAPI(endpoint: string, method = "GET"): Promise<void> {
  const url = `https://www.moltbook.com/api/v1${endpoint}`;
  console.log(`\n🔍 Raw API Test: ${method} ${url}`);

  try {
    const response = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
        "User-Agent": "SHEEP-Federation/1.0",
      },
    });

    console.log(`   Status: ${response.status} ${response.statusText}`);
    console.log(`   Content-Type: ${response.headers.get("content-type")}`);

    const text = await response.text();
    console.log(`   Response length: ${text.length} bytes`);

    if (text.length < 500) {
      console.log(`   Response preview: ${text.substring(0, 200)}`);
    } else {
      console.log(`   Response preview: ${text.substring(0, 200)}...`);
    }

    // Try to parse as JSON
    try {
      const json = JSON.parse(text);
      console.log(`   ✅ Valid JSON`);
      console.log(`   JSON keys: ${Object.keys(json).join(", ")}`);
      if (Array.isArray(json)) {
        console.log(`   Array length: ${json.length}`);
        if (json.length > 0) {
          console.log(`   First item keys: ${Object.keys(json[0]).join(", ")}`);
        }
      }
    } catch {
      console.log(`   ❌ Not valid JSON (likely HTML)`);
    }
  } catch (error) {
    console.log(`   ❌ Error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runTest(name: string, fn: () => Promise<any>): Promise<TestResult> {
  try {
    console.log(`\n🧪 Testing: ${name}...`);
    const data = await fn();
    console.log(`✅ Success: ${name}`);
    return { test: name, success: true, data };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isAPIError = error instanceof MoltbookAPIError;
    console.log(`❌ Failed: ${name}`);
    console.log(`   Error: ${errorMessage}`);
    if (isAPIError) {
      console.log(`   Status: ${error.status}`);
      if (error.body.length < 500) {
        console.log(`   Body: ${error.body}`);
      } else {
        console.log(`   Body preview: ${error.body.substring(0, 200)}...`);
      }
    }
    return { test: name, success: false, error: errorMessage };
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("MOLTBOOK API CONNECTION TEST");
  console.log("=".repeat(60));

  // First, test raw API endpoints to understand the structure
  console.log("\n📡 PHASE 1: Raw API Endpoint Testing");
  console.log("=".repeat(60));

  await testRawAPI("/agents/me");
  await testRawAPI("/posts?limit=5");
  await testRawAPI("/posts?submolt=sheep-federation&limit=5");
  await testRawAPI("/agents/dm/check");
  await testRawAPI("/agents/search?q=sheep&limit=5");

  console.log("\n" + "=".repeat(60));
  console.log("📡 PHASE 2: Client Library Testing");
  console.log("=".repeat(60));

  const client = new MoltbookClient({
    apiKey: API_KEY,
    baseUrl: "https://www.moltbook.com/api/v1",
    timeout: 30000,
  });

  const results: TestResult[] = [];

  // Test 1: getSelf() - Verify authentication
  results.push(
    await runTest("getSelf() - Authentication", async () => {
      const agent = await client.getSelf();
      console.log(`   Agent ID: ${agent.id}`);
      console.log(`   Agent Name: ${agent.name}`);
      console.log(`   Karma: ${agent.karma}`);
      console.log(`   Verified: ${agent.verified}`);
      return agent;
    }),
  );

  // Test 2: listPosts() - Verify we can read posts
  results.push(
    await runTest("listPosts() - Read posts", async () => {
      const posts = await client.listPosts({ limit: 5 });
      console.log(`   Found ${posts.length} posts`);
      if (posts.length > 0) {
        console.log(`   First post: ${posts[0].title.substring(0, 50)}...`);
      }
      return { count: posts.length, sample: posts[0] };
    }),
  );

  // Test 3: getSubmoltPosts("sheep-federation") - Check if submolt exists
  results.push(
    await runTest('getSubmoltPosts("sheep-federation") - Check submolt', async () => {
      const posts = await client.getSubmoltPosts("sheep-federation", { limit: 10 });
      console.log(`   Found ${posts.length} posts in sheep-federation submolt`);
      if (posts.length > 0) {
        console.log(`   First post: ${posts[0].title.substring(0, 50)}...`);
      }
      return { count: posts.length, sample: posts[0] };
    }),
  );

  // Test 4: checkDMs() - Verify DM endpoint works
  results.push(
    await runTest("checkDMs() - Check DMs", async () => {
      const dms = await client.checkDMs();
      console.log(`   Found ${dms.length} DMs`);
      if (dms.length > 0) {
        console.log(`   First DM from: ${dms[0].from.name}`);
      }
      return { count: dms.length, sample: dms[0] };
    }),
  );

  // Test 5: searchAgents() - Test agent search
  results.push(
    await runTest("searchAgents() - Search agents", async () => {
      const agents = await client.searchAgents("sheep", 5);
      console.log(`   Found ${agents.length} agents matching 'sheep'`);
      if (agents.length > 0) {
        console.log(`   First agent: ${agents[0].name} (${agents[0].id})`);
      }
      return { count: agents.length, sample: agents[0] };
    }),
  );

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("TEST SUMMARY");
  console.log("=".repeat(60));

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`\n✅ Passed: ${passed}/${results.length}`);
  console.log(`❌ Failed: ${failed}/${results.length}\n`);

  for (const result of results) {
    const icon = result.success ? "✅" : "❌";
    console.log(`${icon} ${result.test}`);
    if (!result.success && result.error) {
      console.log(`   └─ ${result.error}`);
    }
  }

  console.log("\n" + "=".repeat(60));

  // Exit with appropriate code
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
