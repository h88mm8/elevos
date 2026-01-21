import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/**
 * Downloads media from external URL and caches it in Supabase Storage.
 * Returns the public URL of the cached file.
 */
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
    if (claimsError || !claimsData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const { workspaceId, mediaUrl, messageId, mediaType, mimeType } = await req.json();

    if (!workspaceId || !mediaUrl || !messageId) {
      return new Response(JSON.stringify({ error: 'workspaceId, mediaUrl, and messageId are required' }), { 
        status: 400, 
        headers: corsHeaders 
      });
    }

    // Verify workspace membership
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', claimsData.user.id)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), { status: 403, headers: corsHeaders });
    }

    // Use service role for storage operations
    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Check if already cached
    
    const { data: existingFile } = await supabaseAdmin.storage
      .from('message-attachments')
      .list(`${workspaceId}/media`, {
        search: messageId
      });

    if (existingFile && existingFile.length > 0) {
      // Already cached, return public URL
      const { data: publicUrl } = supabaseAdmin.storage
        .from('message-attachments')
        .getPublicUrl(`${workspaceId}/media/${existingFile[0].name}`);
      
      console.log(`Media already cached: ${publicUrl.publicUrl}`);
      return new Response(JSON.stringify({
        success: true,
        cached: true,
        url: publicUrl.publicUrl,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Download media from original URL
    console.log(`Downloading media from: ${mediaUrl.slice(0, 80)}...`);
    const mediaResponse = await fetch(mediaUrl);
    
    if (!mediaResponse.ok) {
      console.error(`Failed to download media: ${mediaResponse.status}`);
      return new Response(JSON.stringify({
        success: false,
        error: 'Media URL expired or unavailable',
        status: mediaResponse.status,
      }), { status: 404, headers: corsHeaders });
    }

    const mediaBlob = await mediaResponse.blob();
    const responseContentType = mediaResponse.headers.get('content-type');
    console.log(`Downloaded ${mediaBlob.size} bytes, response type: ${responseContentType}, blob type: ${mediaBlob.type}`);

    // Determine the best content type to use
    // Priority: provided mimeType > response content-type > blob type > infer from mediaType
    let finalMimeType = mimeType;
    
    if (!finalMimeType || finalMimeType === 'application/octet-stream') {
      finalMimeType = responseContentType?.split(';')[0].trim();
    }
    
    if (!finalMimeType || finalMimeType === 'application/octet-stream') {
      finalMimeType = mediaBlob.type;
    }
    
    if (!finalMimeType || finalMimeType === 'application/octet-stream') {
      // Infer from mediaType parameter
      const typeDefaults: Record<string, string> = {
        'audio': 'audio/ogg',
        'image': 'image/jpeg',
        'video': 'video/mp4',
        'document': 'application/pdf',
      };
      finalMimeType = typeDefaults[mediaType] || 'application/octet-stream';
    }

    console.log(`Using final mimeType: ${finalMimeType}`);

    // Get extension for file path
    const extension = getExtensionFromMimeType(finalMimeType);
    const uploadPath = `${workspaceId}/media/${messageId}.${extension}`;

    // Upload to storage
    const { error: uploadError } = await supabaseAdmin.storage
      .from('message-attachments')
      .upload(uploadPath, mediaBlob, {
        contentType: finalMimeType,
        upsert: true,
      });

    if (uploadError) {
      console.error('Upload error:', uploadError);
      throw uploadError;
    }

    // Get public URL
    const { data: publicUrlData } = supabaseAdmin.storage
      .from('message-attachments')
      .getPublicUrl(uploadPath);

    console.log(`Media cached successfully: ${publicUrlData.publicUrl}`);

    return new Response(JSON.stringify({
      success: true,
      cached: false,
      url: publicUrlData.publicUrl,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in cache-media:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});

function getExtensionFromMimeType(mimeType: string): string {
  const mimeMap: Record<string, string> = {
    'audio/ogg': 'ogg',
    'audio/ogg; codecs=opus': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/wav': 'wav',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'application/pdf': 'pdf',
  };
  
  // Handle mimetypes with parameters (e.g., "audio/ogg; codecs=opus")
  const baseMime = mimeType.split(';')[0].trim();
  return mimeMap[mimeType] || mimeMap[baseMime] || 'bin';
}