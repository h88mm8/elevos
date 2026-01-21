-- Create unique index to prevent duplicate accounts (idempotent upsert)
-- This ensures (workspace_id, account_id) is unique
CREATE UNIQUE INDEX IF NOT EXISTS accounts_workspace_account_unique 
ON public.accounts (workspace_id, account_id);

-- Also add a comment for documentation
COMMENT ON INDEX accounts_workspace_account_unique IS 'Ensures idempotent upserts - one account_id per workspace';