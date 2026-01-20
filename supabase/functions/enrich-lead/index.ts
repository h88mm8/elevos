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

    const { workspaceId, email, revealPhone } = await req.json();

    if (!workspaceId || !email) {
      return new Response(JSON.stringify({ error: 'workspaceId and email are required' }), { status: 400, headers: corsHeaders });
    }

    // Check phone credits
    const { data: credits } = await supabase
      .from('credits')
      .select('phone_credits')
      .eq('workspace_id', workspaceId)
      .single();

    if (!credits || credits.phone_credits < 1) {
      return new Response(JSON.stringify({ error: 'Insufficient phone credits', code: 402 }), { status: 402, headers: corsHeaders });
    }

    // Call Apollo API
    const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY');
    const apolloResponse = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': APOLLO_API_KEY!,
      },
      body: JSON.stringify({
        email,
        reveal_phone_number: revealPhone,
      }),
    });

    const apolloData = await apolloResponse.json();
    console.log('Apollo response:', apolloData);

    const phone = apolloData.person?.phone_numbers?.[0]?.sanitized_number || null;

    if (phone) {
      // Update lead with phone
      await supabase
        .from('leads')
        .update({ phone, enriched_at: new Date().toISOString() })
        .eq('workspace_id', workspaceId)
        .eq('email', email);

      // Deduct credit
      await supabase
        .from('credits')
        .update({ phone_credits: credits.phone_credits - 1 })
        .eq('workspace_id', workspaceId);

      // Log credit usage
      await supabase.from('credit_history').insert({
        workspace_id: workspaceId,
        type: 'phone_enrich',
        amount: -1,
        description: `Enriquecimento: ${email}`,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      phone,
      person: apolloData.person,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error in enrich-lead:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
