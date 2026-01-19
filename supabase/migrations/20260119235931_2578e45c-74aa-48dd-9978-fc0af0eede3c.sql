-- =============================================
-- UNIPILE MESSENGER - MULTI-TENANT SCHEMA
-- =============================================

-- 1. PROFILES TABLE (linked to auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE,
  email TEXT,
  full_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. WORKSPACES TABLE
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_by UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. WORKSPACE MEMBERS TABLE
CREATE TABLE public.workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, user_id)
);

-- 4. CREDITS TABLE (per workspace)
CREATE TABLE public.credits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE UNIQUE,
  leads_credits INTEGER NOT NULL DEFAULT 100,
  phone_credits INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. CREDIT HISTORY TABLE
CREATE TABLE public.credit_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('lead_search', 'phone_enrich', 'credit_add', 'credit_deduct')),
  amount INTEGER NOT NULL,
  description TEXT,
  reference_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. LEADS TABLE
CREATE TABLE public.leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  company TEXT,
  job_title TEXT,
  linkedin_url TEXT,
  country TEXT,
  enriched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 7. CAMPAIGNS TABLE
CREATE TABLE public.campaigns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('email', 'whatsapp', 'linkedin')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'running', 'paused', 'completed', 'failed')),
  message TEXT NOT NULL,
  subject TEXT,
  account_id TEXT,
  schedule TIMESTAMPTZ,
  leads_count INTEGER NOT NULL DEFAULT 0,
  sent_count INTEGER NOT NULL DEFAULT 0,
  failed_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. CAMPAIGN LEADS TABLE
CREATE TABLE public.campaign_leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id UUID NOT NULL REFERENCES public.campaigns(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'bounced')),
  sent_at TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(campaign_id, lead_id)
);

-- =============================================
-- HELPER FUNCTION: Check workspace membership
-- =============================================
CREATE OR REPLACE FUNCTION public.is_workspace_member(workspace_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.workspace_members 
    WHERE workspace_id = workspace_uuid 
    AND user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================
-- HELPER FUNCTION: Check workspace admin
-- =============================================
CREATE OR REPLACE FUNCTION public.is_workspace_admin(workspace_uuid UUID)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.workspace_members 
    WHERE workspace_id = workspace_uuid 
    AND user_id = auth.uid()
    AND role = 'admin'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- =============================================
-- TRIGGER: Auto-create profile on user signup
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- TRIGGER: Auto-create workspace on first user signup
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS TRIGGER AS $$
DECLARE
  new_workspace_id UUID;
BEGIN
  -- Create default workspace for new user
  INSERT INTO public.workspaces (name, created_by)
  VALUES (COALESCE(NEW.full_name, 'Meu Workspace') || '''s Workspace', NEW.user_id)
  RETURNING id INTO new_workspace_id;
  
  -- Add user as admin of the workspace
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, NEW.user_id, 'admin');
  
  -- Create initial credits for the workspace
  INSERT INTO public.credits (workspace_id, leads_credits, phone_credits)
  VALUES (new_workspace_id, 100, 10);
  
  -- Log initial credits
  INSERT INTO public.credit_history (workspace_id, type, amount, description)
  VALUES (new_workspace_id, 'credit_add', 100, 'Créditos iniciais de leads');
  
  INSERT INTO public.credit_history (workspace_id, type, amount, description)
  VALUES (new_workspace_id, 'credit_add', 10, 'Créditos iniciais de telefone');
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_profile_created
  AFTER INSERT ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_profile();

-- =============================================
-- TRIGGER: Update updated_at column
-- =============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_credits_updated_at BEFORE UPDATE ON public.credits FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_leads_updated_at BEFORE UPDATE ON public.leads FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_campaigns_updated_at BEFORE UPDATE ON public.campaigns FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- ROW LEVEL SECURITY POLICIES
-- =============================================

-- PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id);

-- WORKSPACES
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view workspaces they are members of"
  ON public.workspaces FOR SELECT
  USING (is_workspace_member(id));

CREATE POLICY "Users can create workspaces"
  ON public.workspaces FOR INSERT
  WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Admins can update their workspaces"
  ON public.workspaces FOR UPDATE
  USING (is_workspace_admin(id));

-- WORKSPACE MEMBERS
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view members of their workspaces"
  ON public.workspace_members FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "Admins can add members to their workspaces"
  ON public.workspace_members FOR INSERT
  WITH CHECK (is_workspace_admin(workspace_id));

CREATE POLICY "Admins can update members in their workspaces"
  ON public.workspace_members FOR UPDATE
  USING (is_workspace_admin(workspace_id));

CREATE POLICY "Admins can remove members from their workspaces"
  ON public.workspace_members FOR DELETE
  USING (is_workspace_admin(workspace_id));

-- CREDITS
ALTER TABLE public.credits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view credits of their workspaces"
  ON public.credits FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "Admins can update credits"
  ON public.credits FOR UPDATE
  USING (is_workspace_admin(workspace_id));

-- CREDIT HISTORY
ALTER TABLE public.credit_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view credit history of their workspaces"
  ON public.credit_history FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "System can insert credit history"
  ON public.credit_history FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

-- LEADS
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view leads of their workspaces"
  ON public.leads FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "Users can create leads in their workspaces"
  ON public.leads FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "Users can update leads in their workspaces"
  ON public.leads FOR UPDATE
  USING (is_workspace_member(workspace_id));

CREATE POLICY "Users can delete leads in their workspaces"
  ON public.leads FOR DELETE
  USING (is_workspace_member(workspace_id));

-- CAMPAIGNS
ALTER TABLE public.campaigns ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view campaigns of their workspaces"
  ON public.campaigns FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "Users can create campaigns in their workspaces"
  ON public.campaigns FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "Users can update campaigns in their workspaces"
  ON public.campaigns FOR UPDATE
  USING (is_workspace_member(workspace_id));

CREATE POLICY "Users can delete campaigns in their workspaces"
  ON public.campaigns FOR DELETE
  USING (is_workspace_member(workspace_id));

-- CAMPAIGN LEADS
ALTER TABLE public.campaign_leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view campaign leads of their campaigns"
  ON public.campaign_leads FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.campaigns c 
    WHERE c.id = campaign_id 
    AND is_workspace_member(c.workspace_id)
  ));

CREATE POLICY "Users can create campaign leads"
  ON public.campaign_leads FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.campaigns c 
    WHERE c.id = campaign_id 
    AND is_workspace_member(c.workspace_id)
  ));

CREATE POLICY "Users can update campaign leads"
  ON public.campaign_leads FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.campaigns c 
    WHERE c.id = campaign_id 
    AND is_workspace_member(c.workspace_id)
  ));

-- =============================================
-- INDEXES FOR PERFORMANCE
-- =============================================
CREATE INDEX idx_workspace_members_user_id ON public.workspace_members(user_id);
CREATE INDEX idx_workspace_members_workspace_id ON public.workspace_members(workspace_id);
CREATE INDEX idx_leads_workspace_id ON public.leads(workspace_id);
CREATE INDEX idx_leads_email ON public.leads(email);
CREATE INDEX idx_campaigns_workspace_id ON public.campaigns(workspace_id);
CREATE INDEX idx_campaigns_status ON public.campaigns(status);
CREATE INDEX idx_campaign_leads_campaign_id ON public.campaign_leads(campaign_id);
CREATE INDEX idx_campaign_leads_lead_id ON public.campaign_leads(lead_id);
CREATE INDEX idx_credit_history_workspace_id ON public.credit_history(workspace_id);