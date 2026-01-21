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
      // Parse is_sender and media from the original JSON if available
      let isSender = false;
      let originalData: any = null;
      try {
        if (msg.original) {
          originalData = typeof msg.original === 'string' ? JSON.parse(msg.original) : msg.original;
          isSender = originalData?.key?.fromMe === true;
        }
      } catch (e) {
        // If parsing fails, default to false
        console.warn('Failed to parse original:', e);
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
      // Provider stores media info in original.message.{audioMessage, imageMessage, videoMessage, documentMessage}
      let attachments: any[] = [];
      
      // The message ID from provider (used for attachment API fallback)
      const providerMessageId = msg.id || msg.message_id;
      
      // First check if msg has top-level attachments array from Unipile (preferred - has attachment_id)
      if (msg.attachments && Array.isArray(msg.attachments) && msg.attachments.length > 0) {
        attachments = msg.attachments.map((att: any) => ({
          type: att.attachment_type || att.type || getAttachmentType(att.attachment_mime_type || att.mime_type),
          url: att.attachment_url || att.url || att.link || att.media_url,
          mime_type: att.attachment_mime_type || att.mime_type || att.mimetype,
          filename: att.attachment_name || att.filename || att.name,
          size: att.attachment_size || att.size,
          duration: att.attachment_duration || att.duration || att.seconds,
          attachment_id: att.attachment_id, // Preserve for API fallback
          external_message_id: providerMessageId, // Preserve message ID for API fallback
          voice_note: att.voice_note,
        }));
      }
      
      // If no attachments from top-level, check the original.message object for WhatsApp-style attachments
      const originalMessage = originalData?.message;
      if (attachments.length === 0 && originalMessage) {
        // Audio message
        if (originalMessage.audioMessage) {
          const audio = originalMessage.audioMessage;
          attachments.push({
            type: 'audio',
            url: audio.url,
            mime_type: audio.mimetype || 'audio/ogg',
            filename: audio.fileName,
            duration: audio.seconds,
            size: audio.fileLength,
            external_message_id: providerMessageId,
          });
        }
        
        // Image message
        if (originalMessage.imageMessage) {
          const image = originalMessage.imageMessage;
          attachments.push({
            type: 'image',
            url: image.url,
            mime_type: image.mimetype || 'image/jpeg',
            filename: image.fileName,
            external_message_id: providerMessageId,
          });
        }
        
        // Video message
        if (originalMessage.videoMessage) {
          const video = originalMessage.videoMessage;
          attachments.push({
            type: 'video',
            url: video.url,
            mime_type: video.mimetype || 'video/mp4',
            filename: video.fileName,
            duration: video.seconds,
            external_message_id: providerMessageId,
          });
        }
        
        // Document message
        if (originalMessage.documentMessage || originalMessage.documentWithCaptionMessage) {
          const doc = originalMessage.documentMessage || originalMessage.documentWithCaptionMessage?.message?.documentMessage;
          if (doc) {
            attachments.push({
              type: 'document',
              url: doc.url,
              mime_type: doc.mimetype,
              filename: doc.fileName || doc.title,
              size: doc.fileLength,
              external_message_id: providerMessageId,
            });
          }
        }
        
        // Sticker message
        if (originalMessage.stickerMessage) {
          const sticker = originalMessage.stickerMessage;
          attachments.push({
            type: 'image',
            url: sticker.url,
            mime_type: sticker.mimetype || 'image/webp',
            filename: 'sticker.webp',
            external_message_id: providerMessageId,
          });
        }
      }
      
      // Check individual media fields at top level
      if (attachments.length === 0) {
        if (msg.audio || msg.voice) {
          const audio = msg.audio || msg.voice;
          attachments.push({
            type: 'audio',
            url: audio.url || audio.link || audio.media_url,
            mime_type: audio.mime_type || audio.mimetype || 'audio/ogg',
            filename: audio.filename,
            duration: audio.duration || audio.seconds,
            external_message_id: providerMessageId,
          });
        }
        
        if (msg.image) {
          attachments.push({
            type: 'image',
            url: msg.image.url || msg.image.link,
            mime_type: msg.image.mime_type || 'image/jpeg',
            filename: msg.image.filename,
            external_message_id: providerMessageId,
          });
        }
        
        if (msg.video) {
          attachments.push({
            type: 'video',
            url: msg.video.url || msg.video.link,
            mime_type: msg.video.mime_type || 'video/mp4',
            filename: msg.video.filename,
            duration: msg.video.duration,
            external_message_id: providerMessageId,
          });
        }
        
        if (msg.document) {
          attachments.push({
            type: 'document',
            url: msg.document.url || msg.document.link,
            mime_type: msg.document.mime_type,
            filename: msg.document.filename || msg.document.name,
            size: msg.document.size,
            external_message_id: providerMessageId,
          });
        }
      }
      
      // Filter out attachments without valid URLs
      attachments = attachments.filter(att => att.url);
      
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
    
    // ============================================
    // MERGE CACHED ATTACHMENTS: Check audit log for cached URLs
    // ============================================
    // Fetch cached attachments from our messages table
    const messageIds = mappedMessages.map((m: any) => m.id).filter(Boolean);
    
    if (messageIds.length > 0) {
      const { data: cachedMessages } = await supabase
        .from('messages')
        .select('external_id, attachments')
        .eq('workspace_id', workspaceId)
        .in('external_id', messageIds);
      
      if (cachedMessages && cachedMessages.length > 0) {
        const cachedMap = new Map<string, any[]>();
        for (const cm of cachedMessages) {
          if (cm.external_id && cm.attachments) {
            const atts = typeof cm.attachments === 'string' 
              ? JSON.parse(cm.attachments) 
              : cm.attachments;
            if (Array.isArray(atts) && atts.length > 0) {
              cachedMap.set(cm.external_id, atts);
            }
          }
        }
        
        // Replace temporary URLs with cached storage URLs
        for (const msg of mappedMessages) {
          const cached = cachedMap.get(msg.id);
          if (cached && msg.attachments) {
            // Match by index and type
            msg.attachments = msg.attachments.map((att: any, idx: number) => {
              const cachedAtt = cached[idx];
              if (cachedAtt && cachedAtt.url) {
                // Prefer storage URL if available
                const isCachedUrl = cachedAtt.url.includes('supabase') && cachedAtt.url.includes('storage');
                if (isCachedUrl) {
                  console.log(`Using cached URL for message ${msg.id} attachment ${idx}`);
                  return { ...att, url: cachedAtt.url, original_url: att.url };
                }
              }
              return att;
            });
          } else if (cached && !msg.attachments) {
            // Message from provider has no attachments but we have cached ones
            msg.attachments = cached;
          }
        }
      }
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
