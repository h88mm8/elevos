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

    const { workspaceId, email, leadId, revealPhone } = await req.json();

    if (!workspaceId || !email) {
      return new Response(JSON.stringify({ error: 'workspaceId and email are required' }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // MEMBERSHIP CHECK: Verify user belongs to workspace
    // ============================================
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', claimsData.user.id)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), { status: 403, headers: corsHeaders });
    }

    // ============================================
    // CALL APOLLO API: Enrich lead with phone number
    // ============================================
    const APOLLO_API_KEY = Deno.env.get('APOLLO_API_KEY');
    if (!APOLLO_API_KEY) {
      return new Response(JSON.stringify({ error: 'APOLLO_API_KEY not configured' }), { status: 500, headers: corsHeaders });
    }

    const apolloResponse = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': APOLLO_API_KEY,
      },
      body: JSON.stringify({
        email,
        reveal_phone_number: revealPhone !== false, // Default to true
      }),
    });

    if (!apolloResponse.ok) {
      const errorText = await apolloResponse.text();
      throw new Error(`Apollo API error: ${apolloResponse.status} - ${errorText}`);
    }

    const apolloData = await apolloResponse.json();
    console.log('Apollo response for:', email);

    const phone = apolloData.person?.phone_numbers?.[0]?.sanitized_number || null;

    // ============================================
    // DEBIT CREDITS: Only if phone was found
    // Generate unique enrichRequestId per call to avoid collisions
    // ============================================
    if (phone) {
      // Generate unique request ID for this enrichment call
      const enrichRequestId = crypto.randomUUID();

      const { data: debitSuccess, error: debitError } = await supabase.rpc('deduct_credits', {
        p_workspace_id: workspaceId,
        p_type: 'phone',
        p_amount: 1,
        p_reference_id: enrichRequestId, // MANDATORY: UUID per call (not email to avoid collision)
        p_description: `Enriquecimento: ${email}`,
      });

      if (debitError) {
        console.error('Credit system error:', debitError);
        return new Response(JSON.stringify({ error: 'Credit system error', details: debitError.message }), { 
          status: 500, 
          headers: corsHeaders 
        });
      }

      if (!debitSuccess) {
        return new Response(JSON.stringify({ 
          error: 'Insufficient phone credits', 
          code: 'INSUFFICIENT_CREDITS',
          phone, // Still return the phone so frontend knows it was found
          message: 'Phone found but no credits to charge',
        }), { 
          status: 402, 
          headers: corsHeaders 
        });
      }

      console.log(`Phone credit debited for workspace ${workspaceId}, enrichRequestId: ${enrichRequestId}`);

      // Update lead with phone
      const updateFilter = leadId 
        ? { id: leadId }
        : { workspace_id: workspaceId, email };

      const { error: updateError } = await supabase
        .from('leads')
        .update({ phone, enriched_at: new Date().toISOString() })
        .match(updateFilter);

      if (updateError) {
        console.error('Error updating lead:', updateError);
      }
    }

    return new Response(JSON.stringify({
      success: true,
      phone,
      person: apolloData.person,
      credited: !!phone, // Whether a credit was charged
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in enrich-lead:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
