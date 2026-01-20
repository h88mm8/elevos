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
    // ============================================
    // WEBHOOK SIGNATURE VALIDATION (optional)
    // ============================================
    const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
    if (webhookSecret) {
      const signature = req.headers.get('x-webhook-signature') || req.headers.get('x-signature');
      if (!signature) {
        console.warn('Webhook received without signature, but WEBHOOK_SECRET is configured');
        // Still process for now, but log warning
      }
      // TODO: Add signature validation if provider supports it
    }

    // ============================================
    // PARSE WEBHOOK PAYLOAD
    // ============================================
    const payload = await req.json();
    console.log('QR Status Webhook received:', JSON.stringify(payload));

    // Extract event type and data
    // Adapt based on provider's actual webhook format
    const eventType = payload.event || payload.type || payload.status;
    const eventData = payload.data || payload.object || payload;

    // Try to identify the session
    // Provider may send: account_id, name (which contains our session name), or link_id
    const accountId = eventData.account_id || eventData.id || payload.account_id;
    const sessionName = eventData.name || payload.name;
    const linkId = eventData.link_id || payload.link_id;

    console.log(`Event: ${eventType}, Account: ${accountId}, Session: ${sessionName}, Link: ${linkId}`);

    // ============================================
    // SERVICE CLIENT (bypasses RLS)
    // ============================================
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ============================================
    // FIND THE QR SESSION
    // ============================================
    let sessionQuery = serviceClient.from('qr_sessions').select('*');
    
    // Try to match by session_id or by looking for recent pending sessions
    if (linkId) {
      sessionQuery = sessionQuery.eq('session_id', linkId);
    } else if (sessionName && sessionName.includes('-')) {
      // Our session names are formatted as: workspaceId-timestamp
      sessionQuery = sessionQuery.eq('session_id', sessionName);
    }
    
    // Add status filter to only update pending sessions
    sessionQuery = sessionQuery.eq('status', 'pending').order('created_at', { ascending: false }).limit(1);

    const { data: sessions, error: findError } = await sessionQuery;

    if (findError) {
      console.error('Error finding QR session:', findError);
    }

    const session = sessions?.[0];

    // ============================================
    // HANDLE DIFFERENT EVENT TYPES
    // ============================================
    let updateData: Record<string, any> = {};

    // Normalize event types from provider
    const normalizedEvent = eventType?.toLowerCase().replace(/[._-]/g, '');

    if (normalizedEvent === 'qrupdated' || normalizedEvent === 'qrcode' || normalizedEvent === 'checkpoint') {
      // QR code updated
      const newQrCode = eventData.qr_code || eventData.qrcode || eventData.checkpoint?.qrcode;
      if (newQrCode) {
        updateData = {
          status: 'qr_updated',
          qr_code: newQrCode,
        };
        console.log('QR code updated');
      }
    } else if (
      normalizedEvent === 'connected' || 
      normalizedEvent === 'accountcreated' || 
      normalizedEvent === 'accountconnected' ||
      normalizedEvent === 'success' ||
      eventData.status === 'OK' ||
      eventData.status === 'CONNECTED'
    ) {
      // Account connected successfully
      updateData = {
        status: 'connected',
        account_id: accountId,
        account_name: eventData.name || eventData.display_name || `Account ${accountId?.slice(0, 8)}`,
      };
      console.log(`Account connected: ${accountId}`);
    } else if (
      normalizedEvent === 'failed' || 
      normalizedEvent === 'error' ||
      normalizedEvent === 'expired' ||
      eventData.status === 'FAILED' ||
      eventData.status === 'ERROR'
    ) {
      // Connection failed
      updateData = {
        status: 'failed',
        error: eventData.error || eventData.message || 'Connection failed',
      };
      console.log('Connection failed:', eventData.error || eventData.message);
    } else {
      console.log(`Unhandled event type: ${eventType}`);
    }

    // ============================================
    // UPDATE SESSION IN DATABASE
    // ============================================
    if (Object.keys(updateData).length > 0) {
      if (session) {
        // Update the specific session we found
        const { error: updateError } = await serviceClient
          .from('qr_sessions')
          .update(updateData)
          .eq('id', session.id);

        if (updateError) {
          console.error('Error updating QR session:', updateError);
        } else {
          console.log(`Session ${session.session_id} updated to status: ${updateData.status}`);
        }
      } else if (sessionName && updateData.status === 'connected') {
        // If we couldn't find the session but this is a connected event,
        // try to update by workspace ID extracted from the session name
        const workspaceId = sessionName.split('-')[0];
        if (workspaceId && workspaceId.length === 36) { // UUID length
          const { error: updateError } = await serviceClient
            .from('qr_sessions')
            .update(updateData)
            .eq('workspace_id', workspaceId)
            .eq('status', 'pending')
            .order('created_at', { ascending: false })
            .limit(1);

          if (updateError) {
            console.error('Error updating QR session by workspace:', updateError);
          } else {
            console.log(`Session for workspace ${workspaceId} updated to connected`);
          }
        }
      } else {
        console.log('No matching session found to update');
      }
    }

    return new Response(JSON.stringify({ 
      success: true,
      processed: Object.keys(updateData).length > 0,
    }), { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (err) {
    const error = err as Error;
    console.error('Error in webhook-qr-status:', error);
    // Always return 200 for webhooks to prevent retries
    return new Response(JSON.stringify({ 
      success: false, 
      error: error.message 
    }), { status: 200, headers: corsHeaders });
  }
});
