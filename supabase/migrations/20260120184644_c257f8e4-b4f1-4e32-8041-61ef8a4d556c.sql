-- Criar tabela de listas de leads
CREATE TABLE public.lead_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Adicionar coluna list_id na tabela leads
ALTER TABLE public.leads ADD COLUMN list_id uuid REFERENCES public.lead_lists(id) ON DELETE SET NULL;

-- Índices para performance
CREATE INDEX idx_leads_list_id ON public.leads(list_id);
CREATE INDEX idx_lead_lists_workspace ON public.lead_lists(workspace_id);

-- RLS para lead_lists
ALTER TABLE public.lead_lists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view lists of their workspaces"
  ON public.lead_lists FOR SELECT
  USING (is_workspace_member(workspace_id));

CREATE POLICY "Users can create lists in their workspaces"
  ON public.lead_lists FOR INSERT
  WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "Users can update lists in their workspaces"
  ON public.lead_lists FOR UPDATE
  USING (is_workspace_member(workspace_id));

CREATE POLICY "Users can delete lists in their workspaces"
  ON public.lead_lists FOR DELETE
  USING (is_workspace_member(workspace_id));

-- Trigger para updated_at
CREATE TRIGGER update_lead_lists_updated_at
  BEFORE UPDATE ON public.lead_lists
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();