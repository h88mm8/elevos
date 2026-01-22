# Quota Concurrency Test

This script validates that the `consume_workspace_quota` RPC is atomic and prevents race conditions.

## What it does

1. Authenticates as a test user
2. Temporarily sets the workspace's daily search limit to **2**
3. Fires **10 parallel requests** to `linkedin-search`
4. Validates that exactly **2 succeed** and **8 are blocked**
5. Checks the `usage_events` table to confirm the counts
6. Restores the original limit

## Prerequisites

- Node.js 18+ or Bun
- A test user account with access to a workspace
- Service role key (for setup/cleanup operations)

## Environment Variables

```bash
export SUPABASE_URL="https://pcqompvgdgufjqibiwdj.supabase.co"
export SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
export SUPABASE_SERVICE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
export TEST_USER_EMAIL="test@example.com"
export TEST_USER_PASSWORD="your-password"
export WORKSPACE_ID="uuid-of-workspace"
```

## Running the Test

### With Bun (recommended)
```bash
cd scripts
bun run testQuotaConcurrency.ts
```

### With ts-node
```bash
cd scripts
npx ts-node testQuotaConcurrency.ts
```

### With Node.js (compile first)
```bash
cd scripts
npx tsc testQuotaConcurrency.ts
node testQuotaConcurrency.js
```

## Expected Output

```
🧪 Quota Concurrency Test
========================

🔐 Authenticating test user...
✅ Authenticated as: test@example.com

📋 Fetching workspace plan...
✅ Current plan: starter (limit: 20)

⚙️ Setting temporary limit to 2...
✅ Limit set to 2

🧹 Clearing today's usage events for this workspace...
✅ Usage events cleared

🚀 Firing 10 concurrent requests...

📊 Results:
   ✅ OK (200):      2
   🚫 Blocked (429): 8
   ❌ Other errors:  0

🔍 Validating usage_events...
   linkedin_search_page:         2 (expected: 2)
   linkedin_search_page_blocked: 8 (expected: 8)

♻️ Restoring original limit (20)...
✅ Original limit restored

========================================
✅ TEST PASSED: Quota is atomic!
   2 requests allowed, 8 blocked correctly.
```

## Exit Codes

- `0` - Test passed, quota is atomic
- `1` - Test failed (race condition detected or other error)

## Troubleshooting

### "Authentication failed"
- Verify `TEST_USER_EMAIL` and `TEST_USER_PASSWORD` are correct
- Ensure the user exists and has a confirmed email

### "Failed to get workspace plan"
- Verify `WORKSPACE_ID` is a valid UUID
- Ensure the test user is a member of that workspace

### "Other errors" count is high
- Check edge function logs for errors
- Verify `SUPABASE_URL` is correct
- Ensure edge functions are deployed

### More blocked than expected
- This is actually correct behavior! The atomic lock is working.
- If you see 10 blocked, it means previous test data wasn't cleared properly.

## Notes

- The script cleans up today's usage events before running
- Original plan limits are always restored after the test
- The test uses real edge function calls, so it will trigger actual Unipile calls if the quota passes
