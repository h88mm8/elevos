-- Drop the partial index that causes the upsert issue
DROP INDEX IF EXISTS leads_workspace_email_unique;

-- Create a regular unique index (allows NULL emails, but unique constraint on non-null workspace_id + email pairs)
CREATE UNIQUE INDEX leads_workspace_email_unique ON public.leads (workspace_id, email) WHERE email IS NOT NULL;

-- Also create a unique index for linkedin_url to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS leads_workspace_linkedin_unique ON public.leads (workspace_id, linkedin_url) WHERE linkedin_url IS NOT NULL;