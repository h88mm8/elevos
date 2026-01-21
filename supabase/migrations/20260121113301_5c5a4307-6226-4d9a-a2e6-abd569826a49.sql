-- Create chats table for caching conversation metadata
CREATE TABLE public.chats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  attendee_identifier TEXT,
  attendee_name TEXT,
  attendee_picture TEXT,
  last_message TEXT,
  last_message_type TEXT,
  last_message_duration INTEGER,
  last_message_at TIMESTAMPTZ,
  unread_count INTEGER DEFAULT 0,
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, external_id)
);

-- Enable RLS
ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Members can view chats" 
ON public.chats 
FOR SELECT 
USING (is_workspace_member(workspace_id));

CREATE POLICY "Members can insert chats" 
ON public.chats 
FOR INSERT 
WITH CHECK (is_workspace_member(workspace_id));

CREATE POLICY "Members can update chats" 
ON public.chats 
FOR UPDATE 
USING (is_workspace_member(workspace_id));

-- Create index for faster lookups
CREATE INDEX idx_chats_workspace_id ON public.chats(workspace_id);
CREATE INDEX idx_chats_external_id ON public.chats(external_id);
CREATE INDEX idx_chats_attendee_identifier ON public.chats(attendee_identifier);
CREATE INDEX idx_chats_last_message_at ON public.chats(last_message_at DESC);

-- Enable realtime for chats table
ALTER PUBLICATION supabase_realtime ADD TABLE public.chats;