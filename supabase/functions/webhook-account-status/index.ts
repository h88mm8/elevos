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
    // Provider webhook formats:
    // 1. QR flow: { AccountStatus: { account_id, message, account_type }, reason? }
    // 2. Hosted Auth: { event, account_id, name (JSON with workspaceId and accountName), ... }
    const accountStatusData = payload.AccountStatus || payload.accountStatus || {};
    const eventData = payload.data || payload.object || payload;
    
    // Extract account ID from various possible locations
    const accountId = accountStatusData.account_id || eventData.account_id || eventData.id || payload.account_id;
    
    // Name field contains either workspaceId (old) or JSON with workspaceId and accountName (new)
    const rawName = accountStatusData.name || eventData.name || eventData.display_name || payload.name;
    
    // Extract status/message from AccountStatus or other fields
    const accountMessage = accountStatusData.message || '';
    const accountStatus = accountMessage || eventData.status || payload.status;
    const accountType = accountStatusData.account_type || eventData.account_type || payload.account_type || 'whatsapp';
    
    // Event type and other fields
    const eventType = payload.event || payload.type || accountMessage;
    const qrCode = eventData.qrCodeString || eventData.qr_code || eventData.qrcode;
    const errorMessage = payload.reason || eventData.error || payload.error;

    // ============================================
    // PARSE NAME FIELD (may be JSON or plain UUID)
    // ============================================
    let parsedWorkspaceId: string | null = null;
    let parsedAccountName: string | null = null;
    
    // Try to parse as JSON first (new format)
    if (rawName) {
      try {
        const parsed = JSON.parse(rawName);
        if (parsed.workspaceId) {
          parsedWorkspaceId = parsed.workspaceId;
          parsedAccountName = parsed.accountName || null;
          console.log(`Parsed JSON name: workspaceId=${parsedWorkspaceId}, accountName=${parsedAccountName}`);
        }
      } catch {
        // Not JSON, treat as plain value (old format - workspaceId only)
        console.log(`Name is not JSON, treating as plain value: ${rawName}`);
      }
    }

    console.log(`Event: ${eventType}, Account: ${accountId}, Status: ${accountStatus}, Message: ${accountMessage}, RawName: ${rawName}`);

    // ============================================
    // DETERMINE WORKSPACE ID
    // ============================================
    // In Hosted Auth flow, the 'name' field contains the workspaceId (or JSON with it)
    // In QR flow, we look up the session
    let workspaceId: string | null = parsedWorkspaceId;
    let session = null;

    // Check if name is a valid UUID (workspaceId from Hosted Auth - old format)
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!workspaceId && rawName && uuidRegex.test(rawName)) {
      workspaceId = rawName;
      console.log(`Workspace ID from plain name: ${workspaceId}`);
    }

    // Fallback: Try to find by account_id in qr_sessions (legacy QR flow)
    if (!workspaceId && accountId) {
      const { data } = await serviceClient
        .from('qr_sessions')
        .select('*')
        .eq('session_id', accountId)
        .order('created_at', { ascending: false })
        .limit(1);
      
      session = data?.[0];
      if (session) {
        workspaceId = session.workspace_id;
        console.log(`Workspace ID from QR session: ${workspaceId}`);
      }
    }

    // Fallback: Try by account name pattern (workspaceId-timestamp)
    if (!workspaceId && rawName && rawName.includes('-')) {
      const possibleWorkspaceId = rawName.split('-')[0];
      if (possibleWorkspaceId && uuidRegex.test(possibleWorkspaceId)) {
        workspaceId = possibleWorkspaceId;
        console.log(`Workspace ID from name pattern: ${workspaceId}`);
        
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

    // Final account name to use (from JSON or fallback)
    const finalAccountName = parsedAccountName || `Account ${accountId?.slice(0, 8) || 'Unknown'}`;

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
        account_name: finalAccountName,
      };
      console.log(`Account connected: ${accountId}, name: ${finalAccountName}`);
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
    // Now we use workspaceId directly (from Hosted Auth or QR session)
    if (newStatus === 'connected' && workspaceId && accountId) {
      // Map account type to channel
      const channelMap: Record<string, string> = {
        'WHATSAPP': 'whatsapp',
        'LINKEDIN': 'linkedin',
        'MAIL': 'email',
      };
      const channel = channelMap[accountType?.toUpperCase()] || session?.channel || 'whatsapp';

      const { error: upsertError } = await serviceClient
        .from('accounts')
        .upsert({
          account_id: accountId,
          workspace_id: workspaceId,
          channel: channel,
          status: 'connected',
          name: finalAccountName,
          provider: 'messaging',
          updated_at: new Date().toISOString(),
        }, {
          onConflict: 'workspace_id,account_id',
        });

      if (upsertError) {
        console.error('Error upserting account:', upsertError);
      } else {
        console.log(`Account ${accountId} saved/updated successfully for workspace ${workspaceId}`);
      }
    } else if (newStatus === 'connected' && !workspaceId) {
      console.warn(`Cannot save account ${accountId}: no workspaceId found`);
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
