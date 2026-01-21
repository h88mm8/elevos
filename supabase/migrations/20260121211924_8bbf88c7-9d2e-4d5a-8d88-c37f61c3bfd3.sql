-- Add linkedin_action column to campaigns table
ALTER TABLE public.campaigns 
ADD COLUMN linkedin_action text DEFAULT 'dm'::text;

-- Add check constraint to ensure valid values
ALTER TABLE public.campaigns 
ADD CONSTRAINT campaigns_linkedin_action_check 
CHECK (linkedin_action IS NULL OR linkedin_action IN ('dm', 'inmail', 'invite'));

-- Add comment for documentation
COMMENT ON COLUMN public.campaigns.linkedin_action IS 'LinkedIn action type: dm (direct message), inmail (premium), invite (connection request)';