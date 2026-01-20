-- Drop existing table if exists (to recreate with proper schema)
DROP TABLE IF EXISTS public.qr_sessions CASCADE;

-- Create qr_sessions table with attempts tracking
CREATE TABLE public.qr_sessions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel TEXT NOT NULL DEFAULT 'whatsapp',
  status TEXT NOT NULL DEFAULT 'pending',
  qr_code TEXT,
  account_id TEXT,
  account_name TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create qr_session_logs table for audit trail
CREATE TABLE public.qr_session_logs (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  session_id TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  metadata JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Create index for faster lookups
CREATE INDEX idx_qr_sessions_session_id ON public.qr_sessions(session_id);
CREATE INDEX idx_qr_sessions_workspace_status ON public.qr_sessions(workspace_id, status);
CREATE INDEX idx_qr_session_logs_session_id ON public.qr_session_logs(session_id);

-- Enable RLS
ALTER TABLE public.qr_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_session_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for qr_sessions
-- Members can read sessions from their workspace
CREATE POLICY "Members can view workspace QR sessions"
ON public.qr_sessions
FOR SELECT
USING (public.is_workspace_member(workspace_id));

-- Only admins can insert new sessions
CREATE POLICY "Admins can create QR sessions"
ON public.qr_sessions
FOR INSERT
WITH CHECK (public.is_workspace_admin(workspace_id));

-- Only admins can update sessions (or service role via webhook)
CREATE POLICY "Admins can update QR sessions"
ON public.qr_sessions
FOR UPDATE
USING (public.is_workspace_admin(workspace_id));

-- RLS Policies for qr_session_logs
-- Members can read logs for sessions in their workspace
CREATE POLICY "Members can view session logs"
ON public.qr_session_logs
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.qr_sessions qs
    WHERE qs.session_id = qr_session_logs.session_id
    AND public.is_workspace_member(qs.workspace_id)
  )
);

-- Trigger for updated_at
CREATE TRIGGER update_qr_sessions_updated_at
BEFORE UPDATE ON public.qr_sessions
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Enable Realtime for qr_sessions
ALTER PUBLICATION supabase_realtime ADD TABLE public.qr_sessions;