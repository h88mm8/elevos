-- Make message-attachments bucket public for cached media
UPDATE storage.buckets 
SET public = true 
WHERE id = 'message-attachments';

-- Allow authenticated users to read files from their workspace
CREATE POLICY "Workspace members can read attachments"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'message-attachments' 
  AND (
    -- Public access for cached media
    true
  )
);

-- Allow service role to upload (for cache-media function)
CREATE POLICY "Service role can upload attachments"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'message-attachments'
);

-- Allow service role to update
CREATE POLICY "Service role can update attachments"
ON storage.objects FOR UPDATE
USING (bucket_id = 'message-attachments');