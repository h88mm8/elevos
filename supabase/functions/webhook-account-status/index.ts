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
    // WEBHOOK SIGNATURE VALIDATION (mandatory if configured)
    // ============================================
    const webhookSecret = Deno.env.get('WEBHOOK_SECRET');
    if (webhookSecret) {
      const signature = req.headers.get('x-webhook-signature') || req.headers.get('x-signature');
      if (!signature) {
        console.error('Webhook rejected: missing signature');
        return new Response(JSON.stringify({ error: 'Missing signature' }), {
          status: 403,
          headers: corsHeaders,
        });
      }
      
      // HMAC-SHA256 signature validation
      const encoder = new TextEncoder();
      const bodyBytes = await req.clone().arrayBuffer();
      const key = await crypto.subtle.importKey(
        'raw',
        encoder.encode(webhookSecret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign']
      );
      const signatureBytes = await crypto.subtle.sign('HMAC', key, bodyBytes);
      const expectedSignature = Array.from(new Uint8Array(signatureBytes))
        .map(b => b.toString(16).padStart(2, '0'))
        .join('');
      
      if (signature !== expectedSignature) {
        console.error('Webhook rejected: invalid signature');
        return new Response(JSON.stringify({ error: 'Invalid signature' }), {
          status: 403,
          headers: corsHeaders,
        });
      }
    }

    // ============================================
    // PARSE WEBHOOK PAYLOAD
    // ============================================
    const payload = await req.json();
    console.log('Account Status Webhook received:', JSON.stringify(payload));

    // ============================================
    // SERVICE CLIENT (bypasses RLS)
    // ============================================
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ============================================
    // EXTRACT EVENT DATA
    // ============================================
    // Provider webhook format: { AccountStatus: { account_id, message, account_type }, reason? }
    const accountStatusData = payload.AccountStatus || payload.accountStatus || payload;
    const eventData = payload.data || payload.object || payload;
    
    // Extract account ID from AccountStatus or other fields
    const accountId = accountStatusData.account_id || eventData.account_id || eventData.id || payload.account_id;
    const accountName = accountStatusData.name || eventData.name || eventData.display_name || payload.name;
    
    // Extract status from AccountStatus.message or other fields
    const accountMessage = accountStatusData.message || '';
    const accountStatus = accountMessage || eventData.status || payload.status;
    const accountType = accountStatusData.account_type || eventData.account_type || 'whatsapp';
    
    // Event type and other fields
    const eventType = payload.event || payload.type || accountMessage;
    const qrCode = eventData.qrCodeString || eventData.qr_code || eventData.qrcode;
    const errorMessage = payload.reason || eventData.error || payload.error;

    console.log(`Event: ${eventType}, Account: ${accountId}, Status: ${accountStatus}, Message: ${accountMessage}`);

    // ============================================
    // FIND THE QR SESSION
    // ============================================
    let session = null;

    // Try to find by account_id (session_id in our table)
    if (accountId) {
      const { data } = await serviceClient
        .from('qr_sessions')
        .select('*')
        .eq('session_id', accountId)
        .order('created_at', { ascending: false })
        .limit(1);
      
      session = data?.[0];
    }

    // If not found, try by account name pattern (workspaceId-timestamp)
    if (!session && accountName && accountName.includes('-')) {
      const workspaceId = accountName.split('-')[0];
      if (workspaceId && workspaceId.length === 36) {
        const { data } = await serviceClient
          .from('qr_sessions')
          .select('*')
          .eq('workspace_id', workspaceId)
          .in('status', ['pending', 'qr_updated'])
          .order('created_at', { ascending: false })
          .limit(1);
        
        session = data?.[0];
      }
    }

    // ============================================
    // DETERMINE NEW STATUS
    // ============================================
    let newStatus: string | null = null;
    let updateData: Record<string, any> = {};

    const normalizedEvent = (eventType || '').toLowerCase().replace(/[._-]/g, '');
    const normalizedAccountStatus = (accountStatus || '').toUpperCase();
    const normalizedMessage = (accountMessage || '').toUpperCase();

    // QR Code Updated
    if (normalizedEvent === 'qrupdated' || normalizedEvent === 'qrcode' || normalizedEvent === 'checkpoint') {
      if (qrCode) {
        newStatus = 'qr_updated';
        updateData = { status: newStatus, qr_code: qrCode };
        console.log('QR code updated');
      }
    }
    // Account Connected (OK or CREATION_SUCCESS messages)
    else if (
      normalizedMessage === 'OK' ||
      normalizedMessage === 'CREATION_SUCCESS' ||
      normalizedEvent === 'connected' ||
      normalizedEvent === 'accountcreated' ||
      normalizedEvent === 'accountconnected' ||
      normalizedEvent === 'success' ||
      normalizedAccountStatus === 'OK' ||
      normalizedAccountStatus === 'CONNECTED' ||
      normalizedAccountStatus === 'CREATION_SUCCESS'
    ) {
      newStatus = 'connected';
      updateData = {
        status: newStatus,
        account_id: accountId,
        account_name: accountName || `Account ${accountId?.slice(0, 8) || 'Unknown'}`,
      };
      console.log(`Account connected: ${accountId}`);
    }
    // Account Failed / Error
    else if (
      normalizedMessage === 'FAILED' ||
      normalizedMessage === 'ERROR' ||
      normalizedEvent === 'failed' ||
      normalizedEvent === 'error' ||
      normalizedEvent === 'expired' ||
      normalizedAccountStatus === 'FAILED' ||
      normalizedAccountStatus === 'ERROR'
    ) {
      newStatus = 'failed';
      updateData = {
        status: newStatus,
        error: errorMessage || 'Conexão falhou',
      };
      console.log('Connection failed:', errorMessage);
    }
    // Account Disconnected / Credentials Invalid
    else if (
      normalizedMessage === 'CREDENTIALS' ||
      normalizedMessage === 'DISCONNECTED' ||
      normalizedEvent === 'disconnected' ||
      normalizedEvent === 'credentials' ||
      normalizedAccountStatus === 'DISCONNECTED' ||
      normalizedAccountStatus === 'CREDENTIALS'
    ) {
      // Update the accounts table to mark as disconnected
      if (accountId) {
        const { error: accountUpdateError } = await serviceClient
          .from('accounts')
          .update({ status: 'disconnected', updated_at: new Date().toISOString() })
          .eq('account_id', accountId);

        if (accountUpdateError) {
          console.error('Error updating account status:', accountUpdateError);
        } else {
          console.log(`Account ${accountId} marked as disconnected`);
        }
      }

      // Also update QR session if exists
      newStatus = 'disconnected';
      updateData = { status: newStatus, error: errorMessage || 'Conta desconectada' };
    }
    else {
      console.log(`Unhandled event type: ${eventType}, status: ${accountStatus}, message: ${accountMessage}`);
    }

    // ============================================
    // UPDATE QR SESSION
    // ============================================
    if (session && Object.keys(updateData).length > 0) {
      const { error: updateError } = await serviceClient
        .from('qr_sessions')
        .update(updateData)
        .eq('id', session.id);

      if (updateError) {
        console.error('Error updating QR session:', updateError);
      } else {
        console.log(`Session ${session.session_id} updated to status: ${newStatus}`);
      }

      // Log the event
      await serviceClient.from('qr_session_logs').insert({
        session_id: session.session_id,
        status: newStatus || 'unknown',
        error: updateData.error || null,
        metadata: { 
          event_type: eventType,
          account_status: accountStatus,
          account_id: accountId,
        },
      });
    }

    // ============================================
    // SAVE/UPDATE ACCOUNT IF CONNECTED
    // ============================================
    if (newStatus === 'connected' && session && accountId) {
      const { error: upsertError } = await serviceClient
        .from('accounts')
        .upsert({
          account_id: accountId,
          workspace_id: session.workspace_id,
          channel: session.channel || 'whatsapp',
          status: 'connected',
          name: accountName || `Account ${accountId.slice(0, 8)}`,
          provider: 'messaging',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'workspace_id,account_id',
        });

      if (upsertError) {
        console.error('Error upserting account:', upsertError);
      } else {
        console.log(`Account ${accountId} saved/updated successfully`);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      processed: Object.keys(updateData).length > 0,
      new_status: newStatus,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const error = err as Error;
    console.error('Error in webhook-account-status:', error);
    // Always return 200 for webhooks to prevent retries
    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), { status: 200, headers: corsHeaders });
  }
});
