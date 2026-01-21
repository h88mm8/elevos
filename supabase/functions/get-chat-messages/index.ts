import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claimsData?.claims?.sub) {
      console.error('Auth error:', claimsError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }
    
    const userId = claimsData.claims.sub;

    const { workspaceId, chatId, limit = 50, before } = await req.json();

    if (!workspaceId || !chatId) {
      return new Response(JSON.stringify({ error: 'workspaceId and chatId are required' }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // MEMBERSHIP CHECK: Verify user belongs to workspace
    // ============================================
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), { status: 403, headers: corsHeaders });
    }

    // ============================================
    // CALL MESSAGING PROVIDER API: Get chat messages
    // ============================================
    const PROVIDER_DSN = Deno.env.get('UNIPILE_DSN');
    const PROVIDER_API_KEY = Deno.env.get('UNIPILE_API_KEY');

    if (!PROVIDER_DSN || !PROVIDER_API_KEY) {
      console.log('Messaging provider not configured, returning empty messages');
      return new Response(JSON.stringify({
        success: true,
        messages: [],
        message: 'Messaging service not configured',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let url = `https://${PROVIDER_DSN}/api/v1/chats/${chatId}/messages?limit=${limit}`;
    // Use 'cursor' for pagination (not 'before' which expects ISO datetime)
    if (before) {
      url += `&cursor=${before}`;
    }

    const providerResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': PROVIDER_API_KEY,
        'accept': 'application/json',
      },
    });

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text();
      console.error('Provider API error:', providerResponse.status, errorText);
      
      if (providerResponse.status === 404) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Chat not found',
          messages: [],
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      throw new Error(`Provider API error: ${providerResponse.status}`);
    }

    const providerData = await providerResponse.json();
    console.log(`Retrieved ${providerData.items?.length || 0} messages from chat ${chatId}`);
    
    // Log sample structure for debugging
    if (providerData.items?.length > 0) {
      console.log('Sample message structure:', JSON.stringify(providerData.items[0]).slice(0, 500));
    }

    // Map provider response to our Message interface
    // Based on actual Unipile response structure from logs:
    // {"object":"Message","seen":0,"text":"e vc esta em que area sabia??","edited":0,
    //  "hidden":0,"chat_id":"...","deleted":0,"seen_by":{},"behavior":0,"is_event":0,
    //  "original":"{\"key\":{...\"fromMe\":true,...},...}
    // The "fromMe" field in original.key indicates if the message was sent by us
    const mappedMessages = (providerData.items || []).map((msg: any) => {
      // Parse is_sender from the original JSON if available
      let isSender = false;
      try {
        if (msg.original) {
          const original = typeof msg.original === 'string' ? JSON.parse(msg.original) : msg.original;
          isSender = original?.key?.fromMe === true;
        }
      } catch (e) {
        // If parsing fails, default to false
      }
      
      // Determine message status based on provider fields
      // seen: 0 = not seen, 1 = seen
      // For sent messages (fromMe), we track delivery status
      let status: 'sent' | 'delivered' | 'read' = 'sent';
      if (isSender) {
        // Check if message was read (seen > 0 or seen_by has entries)
        const seenByCount = msg.seen_by ? Object.keys(msg.seen_by).length : 0;
        if (msg.seen === 1 || seenByCount > 0) {
          status = 'read';
        } else if (msg.delivered === 1 || msg.ack >= 2) {
          // ack levels: 0=pending, 1=sent, 2=delivered, 3=read (WhatsApp specific)
          status = 'delivered';
        } else if (msg.ack === 3) {
          status = 'read';
        }
      }
      
      // Map attachments (audio, video, images, documents)
      // Provider structure: msg.attachments = [{ type, url, mime_type, filename, size, duration }]
      // Or may come as individual fields: msg.media, msg.audio, msg.document, msg.image, msg.video
      let attachments: any[] = [];
      
      if (msg.attachments && Array.isArray(msg.attachments)) {
        attachments = msg.attachments.map((att: any) => ({
          type: att.type || getAttachmentType(att.mime_type),
          url: att.url || att.link || att.media_url,
          mime_type: att.mime_type || att.mimetype,
          filename: att.filename || att.name,
          size: att.size,
          duration: att.duration,
        }));
      }
      
      // Check individual media fields
      if (msg.audio || msg.voice) {
        const audio = msg.audio || msg.voice;
        attachments.push({
          type: 'audio',
          url: audio.url || audio.link || audio.media_url,
          mime_type: audio.mime_type || audio.mimetype || 'audio/ogg',
          filename: audio.filename,
          duration: audio.duration || audio.seconds,
        });
      }
      
      if (msg.image) {
        attachments.push({
          type: 'image',
          url: msg.image.url || msg.image.link,
          mime_type: msg.image.mime_type || 'image/jpeg',
          filename: msg.image.filename,
        });
      }
      
      if (msg.video) {
        attachments.push({
          type: 'video',
          url: msg.video.url || msg.video.link,
          mime_type: msg.video.mime_type || 'video/mp4',
          filename: msg.video.filename,
          duration: msg.video.duration,
        });
      }
      
      if (msg.document) {
        attachments.push({
          type: 'document',
          url: msg.document.url || msg.document.link,
          mime_type: msg.document.mime_type,
          filename: msg.document.filename || msg.document.name,
          size: msg.document.size,
        });
      }
      
      // Log for debugging when there are attachments
      if (attachments.length > 0) {
        console.log('Message with attachments:', { 
          msgId: msg.id, 
          attachments: attachments.map(a => ({ type: a.type, mime_type: a.mime_type, hasUrl: !!a.url }))
        });
      }
      
      return {
        id: msg.id || msg.message_id,
        chat_id: chatId,
        sender: isSender ? 'me' : 'them',
        text: msg.text || msg.body || msg.content || '',
        timestamp: msg.date || msg.timestamp || msg.created_at || null,
        status: isSender ? status : undefined,
        attachments: attachments.length > 0 ? attachments : undefined,
      };
    });
    
    // Helper function to determine attachment type from mime
    function getAttachmentType(mimeType: string | undefined): string {
      if (!mimeType) return 'file';
      if (mimeType.startsWith('image/')) return 'image';
      if (mimeType.startsWith('video/')) return 'video';
      if (mimeType.startsWith('audio/')) return 'audio';
      if (mimeType === 'application/pdf') return 'document';
      return 'file';
    }

    return new Response(JSON.stringify({
      success: true,
      messages: mappedMessages,
      cursor: providerData.cursor,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in get-chat-messages:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
