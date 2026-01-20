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
    // CALL PROVIDER API: Create QR session
    // ============================================
    const PROVIDER_DSN = Deno.env.get('UNIPILE_DSN');
    const PROVIDER_API_KEY = Deno.env.get('UNIPILE_API_KEY');

    if (!PROVIDER_DSN || !PROVIDER_API_KEY) {
      console.log('Messaging provider not configured');
      return new Response(JSON.stringify({
        error: 'Messaging service not configured',
      }), { status: 503, headers: corsHeaders });
    }

    console.log(`Creating QR session for channel: ${channel}`);

    // Create hosted auth link for WhatsApp
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
        expiresOn: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 minutes
        notify_url: `${Deno.env.get('SUPABASE_URL')}/functions/v1/webhook-qr-status`,
        name: `${workspaceId}-${Date.now()}`,
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

    // Extract session info from provider response
    const sessionId = providerData.object?.id || providerData.id || `session-${Date.now()}`;
    const qrCode = providerData.object?.qr_code || providerData.qr_code || null;
    const hostedUrl = providerData.object?.url || providerData.url || null;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

    return new Response(JSON.stringify({
      success: true,
      session_id: sessionId,
      qr_code: qrCode,
      hosted_url: hostedUrl,
      expires_at: expiresAt,
      channel,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in create-qr-session:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
