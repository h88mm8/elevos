import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-webhook-signature',
};

interface WebhookEvent {
  event: string;
  data: {
    id?: string;
    chat_id?: string;
    account_id?: string;
    text?: string;
    sender_id?: string;
    timestamp?: string;
    attachments?: unknown[];
    status?: string;
  };
}

// Simple HMAC-SHA256 signature validation
async function validateSignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
    
    // Compare signatures (case-insensitive)
    return signature.toLowerCase() === expectedSignature.toLowerCase() ||
           signature.toLowerCase() === `sha256=${expectedSignature.toLowerCase()}`;
  } catch (error) {
    console.error('Signature validation error:', error);
    return false;
  }
}

// Cache media to Supabase Storage
async function cacheMediaToStorage(
  supabase: any,
  mediaUrl: string,
  workspaceId: string,
  messageId: string,
  mediaType: string,
  mimeType: string
): Promise<string | null> {
  try {
    if (!mediaUrl) return null;
    
    console.log(`Caching ${mediaType} for message ${messageId}: ${mediaUrl.slice(0, 60)}...`);
    
    // Download the media
    const mediaResponse = await fetch(mediaUrl);
    if (!mediaResponse.ok) {
      console.error(`Failed to download media: ${mediaResponse.status}`);
      return null;
    }
    
    const mediaBlob = await mediaResponse.blob();
    const contentType = mediaResponse.headers.get('content-type') || mimeType || 'application/octet-stream';
    
    // Determine file extension
    const extensionMap: Record<string, string> = {
      'audio/ogg': 'ogg',
      'audio/mpeg': 'mp3',
      'audio/mp4': 'm4a',
      'audio/aac': 'aac',
      'audio/opus': 'opus',
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'application/pdf': 'pdf',
    };
    const extension = extensionMap[contentType] || contentType.split('/')[1] || 'bin';
    
    // Create file path
    const filePath = `${workspaceId}/${messageId}.${extension}`;
    
    // Upload to storage
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('message-attachments')
      .upload(filePath, mediaBlob, {
        contentType,
        upsert: true,
      });
    
    if (uploadError) {
      console.error('Storage upload error:', uploadError);
      return null;
    }
    
    // Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('message-attachments')
      .getPublicUrl(filePath);
    
    console.log(`Media cached successfully: ${publicUrlData.publicUrl}`);
    return publicUrlData.publicUrl;
  } catch (error) {
    console.error('Error caching media:', error);
    return null;
  }
}

// Process attachments and cache them
async function processAttachments(
  supabase: any,
  attachments: any[],
  workspaceId: string,
  messageId: string
): Promise<any[]> {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) {
    return [];
  }
  
  const processedAttachments = [];
  
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const url = att.url || att.link || att.media_url;
    
    if (!url) {
      processedAttachments.push(att);
      continue;
    }
    
    // Skip if already a storage URL
    if (url.includes('supabase') && url.includes('storage')) {
      processedAttachments.push(att);
      continue;
    }
    
    const cachedUrl = await cacheMediaToStorage(
      supabase,
      url,
      workspaceId,
      `${messageId}-${i}`,
      att.type || 'file',
      att.mime_type || att.mimetype || 'application/octet-stream'
    );
    
    processedAttachments.push({
      ...att,
      url: cachedUrl || url,
      original_url: url,
    });
  }
  
  return processedAttachments;
}

// Extract attachments from original message data
function extractAttachments(data: any): any[] {
  const attachments: any[] = [];
  
  // Direct attachments array
  if (data.attachments && Array.isArray(data.attachments)) {
    return data.attachments;
  }
  
  // Parse from original if available (WhatsApp structure)
  let originalData: any = null;
  if (data.original) {
    try {
      originalData = typeof data.original === 'string' ? JSON.parse(data.original) : data.original;
    } catch (e) {
      // Ignore parse errors
    }
  }
  
  const originalMessage = originalData?.message;
  if (originalMessage) {
    if (originalMessage.audioMessage) {
      const audio = originalMessage.audioMessage;
      attachments.push({
        type: 'audio',
        url: audio.url,
        mime_type: audio.mimetype || 'audio/ogg',
        filename: audio.fileName,
        duration: audio.seconds,
        size: audio.fileLength,
      });
    }
    
    if (originalMessage.imageMessage) {
      const image = originalMessage.imageMessage;
      attachments.push({
        type: 'image',
        url: image.url,
        mime_type: image.mimetype || 'image/jpeg',
        filename: image.fileName,
      });
    }
    
    if (originalMessage.videoMessage) {
      const video = originalMessage.videoMessage;
      attachments.push({
        type: 'video',
        url: video.url,
        mime_type: video.mimetype || 'video/mp4',
        filename: video.fileName,
        duration: video.seconds,
      });
    }
    
    if (originalMessage.documentMessage || originalMessage.documentWithCaptionMessage) {
      const doc = originalMessage.documentMessage || originalMessage.documentWithCaptionMessage?.message?.documentMessage;
      if (doc) {
        attachments.push({
          type: 'document',
          url: doc.url,
          mime_type: doc.mimetype,
          filename: doc.fileName || doc.title,
          size: doc.fileLength,
        });
      }
    }
    
    if (originalMessage.stickerMessage) {
      const sticker = originalMessage.stickerMessage;
      attachments.push({
        type: 'image',
        url: sticker.url,
        mime_type: sticker.mimetype || 'image/webp',
        filename: 'sticker.webp',
      });
    }
  }
  
  return attachments.filter(att => att.url);
}

serve(async (req) => {
  const startTime = Date.now();
  console.log(`[${new Date().toISOString()}] Webhook received - Method: ${req.method}`);
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { 
      status: 405, 
      headers: corsHeaders 
    });
  }

  try {
    // Read body as text for signature validation
    const bodyText = await req.text();
    
    console.log(`Webhook body length: ${bodyText.length}`);
    console.log(`Webhook body preview: ${bodyText.slice(0, 300)}`);
    
    // ============================================
    // SIGNATURE VALIDATION: Validate webhook origin
    // ============================================
    const WEBHOOK_SECRET = Deno.env.get('WEBHOOK_SECRET');
    const signature = req.headers.get('x-webhook-signature') || 
                      req.headers.get('x-signature') ||
                      req.headers.get('x-hub-signature-256');

    if (WEBHOOK_SECRET) {
      // Secret is configured - require valid signature
      if (!signature) {
        console.warn('Webhook rejected: Missing signature header');
        return new Response(JSON.stringify({ 
          error: 'Forbidden: Missing webhook signature' 
        }), { status: 403, headers: corsHeaders });
      }

      const isValid = await validateSignature(bodyText, signature, WEBHOOK_SECRET);
      if (!isValid) {
        console.warn('Webhook rejected: Invalid signature');
        return new Response(JSON.stringify({ 
          error: 'Forbidden: Invalid webhook signature' 
        }), { status: 403, headers: corsHeaders });
      }
      
      console.log('Webhook signature validated successfully');
    } else {
      // No secret configured - log warning but allow (insecure mode)
      console.warn('⚠️ INSECURE MODE: WEBHOOK_SECRET not configured. Webhook signature validation disabled.');
    }

    // Parse body
    const body = JSON.parse(bodyText);
    console.log('Webhook parsed successfully');

    // Use service role for webhook operations (no user auth)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Handle different event formats
    const events: WebhookEvent[] = Array.isArray(body) ? body : [body];

    let processedCount = 0;
    let errorCount = 0;

    for (const event of events) {
      try {
        const eventType = event.event || 'unknown';
        // Unipile sends data at root level, not in event.data
        const data = event.data || event;

        console.log(`Processing event: ${eventType}, account_id: ${data.account_id}, chat_id: ${data.chat_id}`);

        switch (eventType) {
          case 'message.received':
          case 'message_received':
          case 'message.sent':
          case 'message_sent':
          case 'message': {
            // Find account by provider account_id
            const { data: account } = await supabase
              .from('accounts')
              .select('id, workspace_id')
              .eq('account_id', data.account_id)
              .maybeSingle();

            if (!account) {
              console.warn(`Account not found for account_id: ${data.account_id}`);
              continue;
            }

            console.log(`Found account: ${account.id} for workspace: ${account.workspace_id}`);

            // Extract and cache attachments BEFORE saving to database
            const rawAttachments = extractAttachments(data);
            let processedAttachments: any[] = [];
            
            if (rawAttachments.length > 0) {
              console.log(`Processing ${rawAttachments.length} attachments for message ${data.id}`);
              processedAttachments = await processAttachments(
                supabase,
                rawAttachments,
                account.workspace_id,
                data.id || `msg-${Date.now()}`
              );
              console.log(`Cached attachments:`, processedAttachments.map(a => ({ type: a.type, cached: a.url !== a.original_url })));
            }

            // Insert message with cached attachments
            const { error: insertError } = await supabase
              .from('messages')
              .insert({
                workspace_id: account.workspace_id,
                account_id: account.id,
                chat_id: data.chat_id || 'unknown',
                external_id: data.id,
                sender: data.sender_id === data.account_id || eventType === 'message.sent' ? 'me' : 'them',
                text: data.text,
                attachments: processedAttachments.length > 0 ? processedAttachments : null,
                timestamp: data.timestamp || new Date().toISOString(),
              });

            if (insertError) {
              console.error('Error inserting message:', insertError);
              errorCount++;
            } else {
              console.log(`Message inserted successfully: ${data.id}`);
              processedCount++;
            }
            break;
          }

          case 'account.status':
          case 'account.updated': {
            // Update account status
            const newStatus = data.status === 'OK' || data.status === 'CONNECTED' 
              ? 'connected' 
              : 'disconnected';

            const { error: updateError } = await supabase
              .from('accounts')
              .update({ status: newStatus, updated_at: new Date().toISOString() })
              .eq('account_id', data.id);

            if (updateError) {
              console.error('Error updating account status:', updateError);
              errorCount++;
            } else {
              processedCount++;
              console.log(`Account ${data.id} status updated to ${newStatus}`);
            }
            break;
          }

          case 'typing.started':
          case 'typing.stopped':
          case 'chat.typing': {
            // Find account by provider account_id
            const { data: account } = await supabase
              .from('accounts')
              .select('id, workspace_id')
              .eq('account_id', data.account_id)
              .maybeSingle();

            if (!account) {
              console.warn(`Account not found for typing event: ${data.account_id}`);
              continue;
            }

            // Broadcast typing event via Realtime
            const isTyping = eventType === 'typing.started' || 
                            (eventType === 'chat.typing' && data.status !== 'stopped');
            
            const channel = supabase.channel(`typing:${account.workspace_id}`);
            await channel.send({
              type: 'broadcast',
              event: 'typing',
              payload: {
                chat_id: data.chat_id,
                is_typing: isTyping,
                timestamp: new Date().toISOString(),
              },
            });
            
            console.log(`Typing event broadcast for chat ${data.chat_id}: ${isTyping}`);
            processedCount++;
            break;
          }

          default:
            console.log(`Unhandled event type: ${eventType}`);
        }
      } catch (eventError) {
        console.error('Error processing event:', eventError);
        errorCount++;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`Webhook processed in ${duration}ms: ${processedCount} success, ${errorCount} errors`);

    return new Response(JSON.stringify({
      success: true,
      processed: processedCount,
      errors: errorCount,
      duration_ms: duration,
    }), { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (err) {
    const error = err as Error;
    console.error('Error in webhook-messages:', error);
    // Always return 200 for webhooks to prevent retries
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), { 
      status: 200, 
      headers: corsHeaders 
    });
  }
});
