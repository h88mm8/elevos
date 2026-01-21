-- Create tags table
CREATE TABLE IF NOT EXISTS public.tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#3b82f6',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, name)
);

-- Create lead_tags junction table
CREATE TABLE IF NOT EXISTS public.lead_tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES public.tags(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(lead_id, tag_id)
);

-- Enable RLS
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_tags ENABLE ROW LEVEL SECURITY;

-- RLS policies for tags
CREATE POLICY "Members can view tags" ON public.tags
  FOR SELECT USING (is_workspace_member(workspace_id));

CREATE POLICY "Members can create tags" ON public.tags
  FOR INSERT WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "Members can update tags" ON public.tags
  FOR UPDATE USING (is_workspace_member(workspace_id));

CREATE POLICY "Members can delete tags" ON public.tags
  FOR DELETE USING (is_workspace_member(workspace_id));

-- RLS policies for lead_tags (check via lead's workspace)
CREATE POLICY "Members can view lead_tags" ON public.lead_tags
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_tags.lead_id
      AND is_workspace_member(l.workspace_id)
    )
  );

CREATE POLICY "Members can create lead_tags" ON public.lead_tags
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_tags.lead_id
      AND is_workspace_member(l.workspace_id)
    )
  );

CREATE POLICY "Members can delete lead_tags" ON public.lead_tags
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = lead_tags.lead_id
      AND is_workspace_member(l.workspace_id)
    )
  );

-- Indexes for performance
CREATE INDEX idx_tags_workspace ON public.tags(workspace_id);
CREATE INDEX idx_lead_tags_lead ON public.lead_tags(lead_id);
CREATE INDEX idx_lead_tags_tag ON public.lead_tags(tag_id);

-- Trigger for updated_at
CREATE TRIGGER update_tags_updated_at
  BEFORE UPDATE ON public.tags
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();