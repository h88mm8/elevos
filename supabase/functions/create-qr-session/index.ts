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
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
    if (claimsError || !claimsData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const { workspaceId, channel = 'whatsapp' } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId is required' }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // ADMIN CHECK: Only admins can create QR sessions
    // ============================================
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', claimsData.user.id)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), { status: 403, headers: corsHeaders });
    }

    if (member.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: corsHeaders });
    }

    // ============================================
    // PROVIDER CONFIGURATION
    // ============================================
    const PROVIDER_DSN = Deno.env.get('UNIPILE_DSN');
    const PROVIDER_API_KEY = Deno.env.get('UNIPILE_API_KEY');

    if (!PROVIDER_DSN || !PROVIDER_API_KEY) {
      console.log('Messaging provider not configured');
      return new Response(JSON.stringify({
        error: 'Messaging service not configured',
      }), { status: 503, headers: corsHeaders });
    }

    // ============================================
    // CREATE HOSTED LINK WITH WEBHOOK NOTIFICATION
    // ============================================
    console.log(`Creating QR session for channel: ${channel}`);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const sessionName = `${workspaceId}-${Date.now()}`;

    // Create hosted auth link - this returns a URL that shows the QR code
    // The notify_url will receive webhook events when status changes
    const providerResponse = await fetch(`https://${PROVIDER_DSN}/api/v1/hosted/accounts/link`, {
      method: 'POST',
      headers: {
        'X-API-KEY': PROVIDER_API_KEY,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        type: 'create',
        providers: [channel.toUpperCase()],
        api_url: `https://${PROVIDER_DSN}`,
        expiresOn: expiresAt.toISOString(),
        notify_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-qr-status`,
        name: sessionName,
      }),
    });

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text();
      console.error('Provider API error:', providerResponse.status, errorText);
      
      return new Response(JSON.stringify({
        error: 'Failed to create QR session',
        details: errorText,
      }), { status: providerResponse.status, headers: corsHeaders });
    }

    const providerData = await providerResponse.json();
    console.log('Provider response:', JSON.stringify(providerData));

    // Extract session info
    const sessionId = providerData.object?.id || providerData.id || sessionName;
    const hostedUrl = providerData.object?.url || providerData.url || null;

    // ============================================
    // FETCH INITIAL QR CODE FROM HOSTED LINK
    // ============================================
    let qrCode: string | null = null;

    // Try to get the QR code from the provider response
    if (providerData.object?.qr_code) {
      qrCode = providerData.object.qr_code;
    } else if (providerData.qr_code) {
      qrCode = providerData.qr_code;
    }

    // If no QR code in response, try to fetch the checkpoint to get QR data
    if (!qrCode && hostedUrl) {
      try {
        // Extract token from hosted URL if available
        const urlMatch = hostedUrl.match(/\/link\/([^\/\?]+)/);
        if (urlMatch) {
          const linkToken = urlMatch[1];
          console.log(`Fetching checkpoint for link token: ${linkToken}`);
          
          const checkpointResponse = await fetch(`https://${PROVIDER_DSN}/api/v1/hosted/accounts/link/${linkToken}/checkpoint`, {
            method: 'GET',
            headers: {
              'X-API-KEY': PROVIDER_API_KEY,
              'accept': 'application/json',
            },
          });
          
          if (checkpointResponse.ok) {
            const checkpointData = await checkpointResponse.json();
            console.log('Checkpoint response:', JSON.stringify(checkpointData));
            
            if (checkpointData.object?.qrcode) {
              qrCode = checkpointData.object.qrcode;
            } else if (checkpointData.qrcode) {
              qrCode = checkpointData.qrcode;
            }
          }
        }
      } catch (err) {
        console.log('Could not fetch checkpoint QR:', err);
      }
    }

    // ============================================
    // STORE SESSION IN DATABASE (for Realtime updates)
    // ============================================
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { error: insertError } = await serviceClient
      .from('qr_sessions')
      .insert({
        session_id: sessionId,
        workspace_id: workspaceId,
        channel,
        status: 'pending',
        qr_code: qrCode,
        expires_at: expiresAt.toISOString(),
      });

    if (insertError) {
      console.error('Error inserting QR session:', insertError);
      // Don't fail - session can still work with just the hosted URL
    }

    console.log(`QR session created: ${sessionId}, has QR: ${!!qrCode}, has URL: ${!!hostedUrl}`);

    return new Response(JSON.stringify({
      success: true,
      session_id: sessionId,
      qr_code: qrCode,
      hosted_url: hostedUrl, // Fallback if QR not available
      expires_at: expiresAt.toISOString(),
      channel,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in create-qr-session:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
