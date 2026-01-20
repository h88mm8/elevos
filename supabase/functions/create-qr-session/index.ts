import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const MAX_ATTEMPTS = 3;
const COOLDOWN_MINUTES = 5;

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
    // SERVICE CLIENT (for bypassing RLS)
    // ============================================
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // ============================================
    // CHECK ATTEMPTS LIMIT
    // ============================================
    const cooldownTime = new Date(Date.now() - COOLDOWN_MINUTES * 60 * 1000);
    
    const { data: recentSessions } = await serviceClient
      .from('qr_sessions')
      .select('attempts, created_at')
      .eq('workspace_id', workspaceId)
      .eq('channel', channel)
      .gte('created_at', cooldownTime.toISOString())
      .order('created_at', { ascending: false })
      .limit(1);

    const lastSession = recentSessions?.[0];
    const currentAttempts = lastSession?.attempts || 0;

    if (currentAttempts >= MAX_ATTEMPTS) {
      const waitMinutes = COOLDOWN_MINUTES;
      console.log(`Workspace ${workspaceId} exceeded max attempts (${currentAttempts}/${MAX_ATTEMPTS})`);
      
      return new Response(JSON.stringify({
        error: 'Limite de tentativas atingido',
        details: `Aguarde ${waitMinutes} minutos antes de tentar novamente.`,
        retry_after: waitMinutes * 60,
      }), { status: 429, headers: corsHeaders });
    }

    // ============================================
    // PROVIDER CONFIGURATION
    // ============================================
    const PROVIDER_DSN = Deno.env.get('UNIPILE_DSN');
    const PROVIDER_API_KEY = Deno.env.get('UNIPILE_API_KEY');

    if (!PROVIDER_DSN || !PROVIDER_API_KEY) {
      console.log('Messaging provider not configured');
      return new Response(JSON.stringify({
        error: 'Serviço de mensagens não configurado',
      }), { status: 503, headers: corsHeaders });
    }

    // ============================================
    // CREATE ACCOUNT WITH QR CODE
    // ============================================
    console.log(`Creating QR session for channel: ${channel}, attempt: ${currentAttempts + 1}`);

    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    const sessionName = `${workspaceId}-${Date.now()}`;

    // Call provider API to create account with QR
    const providerResponse = await fetch(`https://${PROVIDER_DSN}/api/v1/accounts`, {
      method: 'POST',
      headers: {
        'X-API-KEY': PROVIDER_API_KEY,
        'Content-Type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        provider: 'WHATSAPP',
        name: sessionName,
      }),
    });

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text();
      console.error('Provider API error:', providerResponse.status, errorText);
      
      // Log the failure
      await serviceClient.from('qr_session_logs').insert({
        session_id: sessionName,
        status: 'provider_error',
        error: errorText,
        metadata: { provider_status: providerResponse.status },
      });
      
      return new Response(JSON.stringify({
        error: 'Falha ao criar sessão',
        details: 'Não foi possível conectar ao serviço de mensagens.',
      }), { status: providerResponse.status, headers: corsHeaders });
    }

    const providerData = await providerResponse.json();
    console.log('Provider response:', JSON.stringify(providerData));

    // Extract QR code and session info
    const accountId = providerData.account_id || providerData.object?.account_id;
    const qrCodeString = providerData.qrCodeString || providerData.object?.qrCodeString;
    const code = providerData.code || providerData.object?.code;

    if (!qrCodeString && !code) {
      console.error('No QR code in provider response:', providerData);
      
      await serviceClient.from('qr_session_logs').insert({
        session_id: sessionName,
        status: 'no_qr_code',
        error: 'Provider did not return QR code',
        metadata: providerData,
      });
      
      return new Response(JSON.stringify({
        error: 'QR Code não disponível',
        details: 'O serviço não retornou um QR Code válido.',
      }), { status: 500, headers: corsHeaders });
    }

    // Use qrCodeString (base64) or code (raw string)
    const qrCode = qrCodeString || code;

    // ============================================
    // STORE SESSION IN DATABASE
    // ============================================
    const { data: session, error: insertError } = await serviceClient
      .from('qr_sessions')
      .insert({
        session_id: accountId || sessionName,
        workspace_id: workspaceId,
        channel,
        status: 'pending',
        qr_code: qrCode,
        attempts: currentAttempts + 1,
        expires_at: expiresAt.toISOString(),
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting QR session:', insertError);
    }

    // Log session creation
    await serviceClient.from('qr_session_logs').insert({
      session_id: accountId || sessionName,
      status: 'pending',
      metadata: { 
        attempt: currentAttempts + 1,
        has_qr: !!qrCode,
        account_id: accountId,
      },
    });

    console.log(`QR session created: ${accountId || sessionName}, attempt: ${currentAttempts + 1}`);

    return new Response(JSON.stringify({
      success: true,
      session_id: accountId || sessionName,
      qr_code: qrCode,
      expires_at: expiresAt.toISOString(),
      channel,
      attempts: currentAttempts + 1,
      max_attempts: MAX_ATTEMPTS,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in create-qr-session:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
