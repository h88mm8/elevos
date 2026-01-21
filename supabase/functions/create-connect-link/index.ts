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
    // AUTHENTICATE USER
    // ============================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    
    // Use anon client for auth validation
    const supabaseAuth = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!
    );

    const { data: { user }, error: authError } = await supabaseAuth.auth.getUser(token);
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(JSON.stringify({ error: 'Invalid token' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Use service role for database queries (bypasses RLS)
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ============================================
    // PARSE REQUEST
    // ============================================
    const { workspaceId, channel = 'whatsapp', accountName } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Creating connect link for workspace: ${workspaceId}, channel: ${channel}, accountName: ${accountName}`);

    // ============================================
    // VERIFY ADMIN MEMBERSHIP
    // ============================================
    const { data: membership, error: memberError } = await supabase
      .from('workspace_members')
      .select('role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', user.id)
      .single();

    if (memberError || !membership) {
      console.error('Membership error:', memberError);
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (membership.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can connect accounts' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================
    // GET PROVIDER CREDENTIALS
    // ============================================
    const providerDsn = Deno.env.get('UNIPILE_DSN');
    const providerApiKey = Deno.env.get('UNIPILE_API_KEY');

    if (!providerDsn || !providerApiKey) {
      console.error('Missing provider credentials');
      return new Response(JSON.stringify({ error: 'Provider not configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================
    // BUILD WEBHOOK URL
    // ============================================
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const webhookUrl = `${supabaseUrl}/functions/v1/webhook-account-status`;

    // ============================================
    // MAP CHANNEL TO PROVIDER
    // ============================================
    const providerMap: Record<string, string> = {
      whatsapp: 'WHATSAPP',
      linkedin: 'LINKEDIN',
      email: 'MAIL',
    };

    const providerChannel = providerMap[channel.toLowerCase()] || 'WHATSAPP';

    // ============================================
    // CALL PROVIDER API TO CREATE HOSTED AUTH LINK
    // ============================================
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString(); // 10 minutes

    // Store both workspaceId and accountName in the name field (JSON encoded)
    const namePayload = JSON.stringify({ 
      workspaceId, 
      accountName: accountName || null 
    });

    const requestBody = {
      type: 'create',
      providers: [providerChannel],
      api_url: `https://${providerDsn}`,
      expiresOn: expiresAt,
      notify_url: webhookUrl,
      name: namePayload, // Used to correlate in webhook
    };

    console.log('Provider request:', JSON.stringify(requestBody));

    const providerResponse = await fetch(`https://${providerDsn}/api/v1/hosted/accounts/link`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': providerApiKey,
      },
      body: JSON.stringify(requestBody),
    });

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text();
      console.error('Provider error:', providerResponse.status, errorText);
      return new Response(JSON.stringify({ 
        error: 'Failed to create connection link',
        details: errorText,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const providerData = await providerResponse.json();
    console.log('Provider response:', JSON.stringify(providerData));

    // ============================================
    // EXTRACT URL FROM RESPONSE
    // ============================================
    const connectUrl = providerData.url || providerData.link || providerData.hosted_url;

    if (!connectUrl) {
      console.error('No URL in provider response:', providerData);
      return new Response(JSON.stringify({ 
        error: 'No connection URL returned',
        details: providerData,
      }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Connect link created: ${connectUrl}`);

    return new Response(JSON.stringify({
      success: true,
      url: connectUrl,
      expires_at: expiresAt,
      channel: channel,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    const error = err as Error;
    console.error('Error in create-connect-link:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
