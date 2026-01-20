-- Create storage bucket for message attachments
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'message-attachments', 
  'message-attachments', 
  false,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf', 'video/mp4', 'audio/mpeg', 'audio/ogg']
);

-- RLS policies for message attachments bucket
CREATE POLICY "Workspace members can upload attachments"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'message-attachments' AND
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.user_id = auth.uid()
    AND wm.workspace_id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "Workspace members can view attachments"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'message-attachments' AND
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.user_id = auth.uid()
    AND wm.workspace_id::text = (storage.foldername(name))[1]
  )
);

CREATE POLICY "Workspace members can delete attachments"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'message-attachments' AND
  EXISTS (
    SELECT 1 FROM public.workspace_members wm
    WHERE wm.user_id = auth.uid()
    AND wm.workspace_id::text = (storage.foldername(name))[1]
  )
);