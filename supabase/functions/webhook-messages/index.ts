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

serve(async (req) => {
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
    console.log('Webhook received:', JSON.stringify(body).slice(0, 500));

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
        const data = event.data || event;

        console.log(`Processing event: ${eventType}`);

        switch (eventType) {
          case 'message.received':
          case 'message.sent':
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

            // Insert message (audit log - UI continues reading from provider API)
            const { error: insertError } = await supabase
              .from('messages')
              .insert({
                workspace_id: account.workspace_id,
                account_id: account.id,
                chat_id: data.chat_id || 'unknown',
                external_id: data.id,
                sender: data.sender_id === data.account_id ? 'me' : 'them',
                text: data.text,
                attachments: data.attachments,
                timestamp: data.timestamp || new Date().toISOString(),
              });

            if (insertError) {
              console.error('Error inserting message:', insertError);
              errorCount++;
            } else {
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

    console.log(`Webhook processed: ${processedCount} success, ${errorCount} errors`);

    return new Response(JSON.stringify({
      success: true,
      processed: processedCount,
      errors: errorCount,
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
