-- Create platform_settings table (singleton pattern)
CREATE TABLE public.platform_settings (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  linkedin_search_account_id uuid NULL REFERENCES public.accounts(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Insert singleton row
INSERT INTO public.platform_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Create platform_admins table
CREATE TABLE public.platform_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS on both tables
ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

-- RLS for platform_admins: users can only select their own row
CREATE POLICY "Users can view their own admin status"
ON public.platform_admins
FOR SELECT
USING (auth.uid() = user_id);

-- RLS for platform_settings: only platform admins can select
CREATE POLICY "Platform admins can view settings"
ON public.platform_settings
FOR SELECT
USING (EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()));

-- RLS for platform_settings: only platform admins can update
CREATE POLICY "Platform admins can update settings"
ON public.platform_settings
FOR UPDATE
USING (EXISTS (SELECT 1 FROM public.platform_admins WHERE user_id = auth.uid()));

-- Helper function to check if user is platform admin
CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.platform_admins 
    WHERE user_id = auth.uid()
  );
END;
$$;

-- Function to get platform LinkedIn search account (for edge functions)
CREATE OR REPLACE FUNCTION public.get_platform_linkedin_search_account()
RETURNS TABLE(account_uuid uuid, account_id text, linkedin_feature text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    a.id as account_uuid,
    a.account_id,
    a.linkedin_feature
  FROM public.platform_settings ps
  JOIN public.accounts a ON a.id = ps.linkedin_search_account_id
  WHERE a.channel = 'linkedin' AND a.status = 'connected';
END;
$$;