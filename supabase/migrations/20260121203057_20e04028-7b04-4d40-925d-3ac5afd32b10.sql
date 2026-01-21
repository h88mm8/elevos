-- Add linkedin_feature column to accounts table
ALTER TABLE public.accounts 
ADD COLUMN linkedin_feature text NULL;

-- Add linkedin_organization_name column (optional, for future use)
ALTER TABLE public.accounts 
ADD COLUMN linkedin_organization_name text NULL;

-- Add comment for documentation
COMMENT ON COLUMN public.accounts.linkedin_feature IS 'LinkedIn account type: classic, sales_navigator, or recruiter';
COMMENT ON COLUMN public.accounts.linkedin_organization_name IS 'Organization name for Sales Navigator/Recruiter accounts';