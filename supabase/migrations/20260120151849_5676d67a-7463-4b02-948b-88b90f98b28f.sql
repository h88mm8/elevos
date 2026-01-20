CREATE OR REPLACE FUNCTION public.handle_new_profile()
RETURNS TRIGGER AS $$
DECLARE
  new_workspace_id UUID;
BEGIN
  INSERT INTO public.workspaces (name, created_by)
  VALUES (COALESCE(NEW.full_name, 'Meu Workspace') || '''s Workspace', NEW.user_id)
  RETURNING id INTO new_workspace_id;

  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, NEW.user_id, 'admin');

  INSERT INTO public.credits (workspace_id, leads_credits, phone_credits)
  VALUES (new_workspace_id, 100, 10);

  INSERT INTO public.credit_history (workspace_id, type, amount, description)
  VALUES (new_workspace_id, 'leads_add', 100, 'Créditos iniciais de leads');

  INSERT INTO public.credit_history (workspace_id, type, amount, description)
  VALUES (new_workspace_id, 'phone_add', 10, 'Créditos iniciais de telefone');

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;