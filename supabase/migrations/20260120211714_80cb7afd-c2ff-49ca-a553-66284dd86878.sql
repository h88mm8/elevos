-- Create table to store QR session status (used with Supabase Realtime)
CREATE TABLE public.qr_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'pending',
  qr_code TEXT,
  account_id TEXT,
  account_name TEXT,
  error TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.qr_sessions ENABLE ROW LEVEL SECURITY;

-- Policy: workspace members can view their sessions
CREATE POLICY "Workspace members can view QR sessions"
ON public.qr_sessions
FOR SELECT
USING (public.is_workspace_member(workspace_id));

-- Policy: workspace admins can insert sessions
CREATE POLICY "Workspace admins can create QR sessions"
ON public.qr_sessions
FOR INSERT
WITH CHECK (public.is_workspace_admin(workspace_id));

-- Policy: service role can update (for webhook)
-- Note: service role bypasses RLS, so no explicit policy needed

-- Add trigger for updated_at
CREATE TRIGGER update_qr_sessions_updated_at
BEFORE UPDATE ON public.qr_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create index for faster lookups
CREATE INDEX idx_qr_sessions_session_id ON public.qr_sessions(session_id);
CREATE INDEX idx_qr_sessions_workspace_id ON public.qr_sessions(workspace_id);

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.qr_sessions;