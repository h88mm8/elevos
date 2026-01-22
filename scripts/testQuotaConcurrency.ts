/**
 * Quota Concurrency Test Script
 * 
 * Validates that consume_workspace_quota RPC is atomic and prevents race conditions.
 * 
 * Expected: With limit=2 and 10 parallel requests:
 * - 2 requests should succeed (200)
 * - 8 requests should be blocked (429)
 */

import { createClient } from '@supabase/supabase-js';

// Configuration from environment
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;
const TEST_USER_EMAIL = process.env.TEST_USER_EMAIL;
const TEST_USER_PASSWORD = process.env.TEST_USER_PASSWORD;
const WORKSPACE_ID = process.env.WORKSPACE_ID;

const CONCURRENT_REQUESTS = 10;
const TEST_LIMIT = 2;

interface TestResult {
  okCount: number;
  blockedCount: number;
  otherErrors: number;
  details: Array<{ status: number; body: any }>;
}

interface UsageValidation {
  searchPageCount: number;
  blockedCount: number;
  valid: boolean;
}

async function main() {
  console.log('🧪 Quota Concurrency Test');
  console.log('========================\n');

  // Validate environment
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY || !SUPABASE_ANON_KEY || !TEST_USER_EMAIL || !TEST_USER_PASSWORD || !WORKSPACE_ID) {
    console.error('❌ Missing required environment variables');
    console.error('Required: SUPABASE_URL, SUPABASE_SERVICE_KEY, SUPABASE_ANON_KEY, TEST_USER_EMAIL, TEST_USER_PASSWORD, WORKSPACE_ID');
    process.exit(1);
  }

  // Create admin client (service role for setup/cleanup)
  const adminClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });

  // Create user client for authentication (uses anon key)
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false }
  });

  try {
    // Step 1: Authenticate test user
    console.log('🔐 Authenticating test user...');
    const { data: authData, error: authError } = await userClient.auth.signInWithPassword({
      email: TEST_USER_EMAIL,
      password: TEST_USER_PASSWORD
    });

    if (authError || !authData.session) {
      console.error('❌ Authentication failed:', authError?.message);
      process.exit(1);
    }
    console.log('✅ Authenticated as:', authData.user?.email);

    // Step 2: Get current plan and store original limit
    console.log('\n📋 Fetching workspace plan...');
    const { data: planData, error: planError } = await adminClient
      .rpc('get_workspace_plan', { p_workspace_id: WORKSPACE_ID });

    if (planError || !planData || planData.length === 0) {
      console.error('❌ Failed to get workspace plan:', planError?.message);
      process.exit(1);
    }

    const originalLimit = planData[0].daily_search_page_limit;
    const planId = planData[0].plan_id;
    console.log(`✅ Current plan: ${planData[0].plan_code} (limit: ${originalLimit})`);

    // Step 3: Set temporary low limit for testing
    console.log(`\n⚙️ Setting temporary limit to ${TEST_LIMIT}...`);
    const { error: updateError } = await adminClient
      .from('plans')
      .update({ daily_search_page_limit: TEST_LIMIT })
      .eq('id', planId);

    if (updateError) {
      console.error('❌ Failed to update plan limit:', updateError.message);
      process.exit(1);
    }
    console.log(`✅ Limit set to ${TEST_LIMIT}`);

    // Step 4: Clear today's usage events for clean test
    console.log('\n🧹 Clearing today\'s usage events for this workspace...');
    // Use start of day in UTC to avoid timezone issues
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayISO = todayStart.toISOString();
    
    const { error: deleteError } = await adminClient
      .from('usage_events')
      .delete()
      .eq('workspace_id', WORKSPACE_ID)
      .in('action', ['linkedin_search_page', 'linkedin_search_page_blocked'])
      .gte('created_at', todayISO);

    if (deleteError) {
      console.warn('⚠️ Could not clear usage events:', deleteError.message);
    } else {
      console.log('✅ Usage events cleared');
    }

    // Step 5: Fire concurrent requests
    console.log(`\n🚀 Firing ${CONCURRENT_REQUESTS} concurrent requests...`);
    const results = await fireConurrentRequests(authData.session.access_token, WORKSPACE_ID);
    
    console.log('\n📊 Results:');
    console.log(`   ✅ OK (200):      ${results.okCount}`);
    console.log(`   🚫 Blocked (429): ${results.blockedCount}`);
    console.log(`   ❌ Other errors:  ${results.otherErrors}`);

    // Step 6: Validate usage_events
    console.log('\n🔍 Validating usage_events...');
    const validation = await validateUsageEvents(adminClient, WORKSPACE_ID);
    
    console.log(`   linkedin_search_page:         ${validation.searchPageCount} (expected: ${TEST_LIMIT})`);
    console.log(`   linkedin_search_page_blocked: ${validation.blockedCount} (expected: ${CONCURRENT_REQUESTS - TEST_LIMIT})`);

    // Step 7: Restore original limit
    console.log(`\n♻️ Restoring original limit (${originalLimit})...`);
    await adminClient
      .from('plans')
      .update({ daily_search_page_limit: originalLimit })
      .eq('id', planId);
    console.log('✅ Original limit restored');

    // Final verdict
    console.log('\n' + '='.repeat(40));
    const expectedOk = TEST_LIMIT;
    const expectedBlocked = CONCURRENT_REQUESTS - TEST_LIMIT;
    
    const isApiCorrect = results.okCount === expectedOk && results.blockedCount === expectedBlocked;
    const isDbCorrect = validation.searchPageCount === expectedOk && validation.blockedCount === expectedBlocked;
    
    if (isApiCorrect && isDbCorrect) {
      console.log('✅ TEST PASSED: Quota is atomic!');
      console.log(`   ${expectedOk} requests allowed, ${expectedBlocked} blocked correctly.`);
      process.exit(0);
    } else {
      console.log('❌ TEST FAILED: Race condition detected!');
      if (!isApiCorrect) {
        console.log(`   API: Expected ${expectedOk} OK / ${expectedBlocked} blocked`);
        console.log(`   Got: ${results.okCount} OK / ${results.blockedCount} blocked`);
      }
      if (!isDbCorrect) {
        console.log(`   DB: Expected ${expectedOk} search_page / ${expectedBlocked} blocked`);
        console.log(`   Got: ${validation.searchPageCount} search_page / ${validation.blockedCount} blocked`);
      }
      process.exit(1);
    }

  } catch (error) {
    console.error('\n💥 Unexpected error:', error);
    process.exit(1);
  }
}

async function fireConurrentRequests(accessToken: string, workspaceId: string): Promise<TestResult> {
  const results: TestResult = {
    okCount: 0,
    blockedCount: 0,
    otherErrors: 0,
    details: []
  };

  const requests = Array(CONCURRENT_REQUESTS).fill(null).map(async (_, index) => {
    try {
      const response = await fetch(`${SUPABASE_URL}/functions/v1/linkedin-search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
          'apikey': SUPABASE_ANON_KEY!
        },
        body: JSON.stringify({
          workspaceId,
          searchType: 'people',
          api: 'classic',
          filters: { keywords: `test-concurrency-${index}` },
          limit: 25
        })
      });

      const body = await response.json().catch(() => ({}));
      results.details.push({ status: response.status, body });

      if (response.status === 200) {
        results.okCount++;
      } else if (response.status === 429) {
        results.blockedCount++;
      } else {
        results.otherErrors++;
        console.log(`   Request ${index + 1}: Status ${response.status}`, body);
      }
    } catch (error) {
      results.otherErrors++;
      console.error(`   Request ${index + 1} failed:`, error);
    }
  });

  await Promise.all(requests);
  return results;
}

async function validateUsageEvents(client: any, workspaceId: string): Promise<UsageValidation> {
  // Use start of day in UTC to avoid timezone issues
  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayISO = todayStart.toISOString();

  const { data, error } = await client
    .from('usage_events')
    .select('action, count')
    .eq('workspace_id', workspaceId)
    .in('action', ['linkedin_search_page', 'linkedin_search_page_blocked'])
    .gte('created_at', todayISO);

  if (error) {
    console.error('❌ Failed to query usage_events:', error.message);
    return { searchPageCount: -1, blockedCount: -1, valid: false };
  }

  let searchPageCount = 0;
  let blockedCount = 0;

  for (const row of data || []) {
    if (row.action === 'linkedin_search_page') {
      searchPageCount += row.count || 1;
    } else if (row.action === 'linkedin_search_page_blocked') {
      blockedCount += row.count || 1;
    }
  }

  return {
    searchPageCount,
    blockedCount,
    valid: true
  };
}

// Run the test
main();
