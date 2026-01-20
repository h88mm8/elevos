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

  // Generate requestId BEFORE any operation (for idempotent rollback)
  const requestId = crypto.randomUUID();
  let creditsDebited = false;
  let workspaceId: string | null = null;
  let fetchCount = 0;
  // deno-lint-ignore no-explicit-any
  let supabaseClient: any = null;

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
    supabaseClient = supabase;

    const token = authHeader.replace('Bearer ', '');
    const { data: claimsData, error: claimsError } = await supabase.auth.getUser(token);
    if (claimsError || !claimsData.user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders });
    }

    const body = await req.json();
    workspaceId = body.workspaceId;
    const { filters } = body;
    fetchCount = body.fetch_count || 10;

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId is required' }), { status: 400, headers: corsHeaders });
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
    // PESSIMISTIC DEBIT: Debit BEFORE external call
    // Using RPC with mandatory reference_id for idempotent rollback
    // ============================================
    const { data: debitSuccess, error: debitError } = await supabase.rpc('deduct_credits', {
      p_workspace_id: workspaceId,
      p_type: 'leads',
      p_amount: fetchCount,
      p_reference_id: requestId, // MANDATORY: UUID generated before any operation
      p_description: `Busca de ${fetchCount} leads`,
    });

    if (debitError) {
      console.error('Credit system error:', debitError);
      return new Response(JSON.stringify({ error: 'Credit system error', details: debitError.message }), { 
        status: 500, 
        headers: corsHeaders 
      });
    }

    if (!debitSuccess) {
      return new Response(JSON.stringify({ error: 'Insufficient credits', code: 'INSUFFICIENT_CREDITS' }), { 
        status: 402, 
        headers: corsHeaders 
      });
    }

    creditsDebited = true;
    console.log(`Credits debited: ${fetchCount} leads for workspace ${workspaceId}, requestId: ${requestId}`);

    // ============================================
    // EXTERNAL CALL: Call Apify API - code_crafter~leads-finder
    // Payload: filters at root of input (not nested)
    // ============================================
    const APIFY_API_TOKEN = Deno.env.get('APIFY_API_TOKEN');
    if (!APIFY_API_TOKEN) {
      throw new Error('APIFY_API_TOKEN not configured');
    }

    // Build input payload with filters at root level (not nested)
    const apifyInput: Record<string, unknown> = {
      fetch_count: fetchCount,
      email_status: ['validated'],
    };

    // Add filters directly to input (not nested inside a filters object)
    if (filters?.job_title) apifyInput.job_title = filters.job_title;
    if (filters?.company_domain) apifyInput.company_domain = filters.company_domain;
    if (filters?.company) apifyInput.company_domain = filters.company; // Alias support
    if (filters?.country) apifyInput.country = filters.country;
    if (filters?.location) apifyInput.location = filters.location;

    console.log('Calling Apify actor code_crafter~leads-finder with input:', JSON.stringify(apifyInput));

    const apifyResponse = await fetch(
      `https://api.apify.com/v2/acts/code_crafter~leads-finder/runs?token=${APIFY_API_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: apifyInput }),
      }
    );

    if (!apifyResponse.ok) {
      const errorText = await apifyResponse.text();
      throw new Error(`Apify API error: ${apifyResponse.status} - ${errorText}`);
    }

    const apifyData = await apifyResponse.json();
    const runId = apifyData.data?.id;

    if (!runId) {
      throw new Error('Apify did not return a valid runId');
    }

    console.log('Apify run started:', { runId, requestId, actor: 'code_crafter~leads-finder' });

    return new Response(JSON.stringify({
      success: true,
      runId,
      requestId, // Return requestId for client reference
      message: 'Lead search started',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in search-leads:', error);

    // ============================================
    // IDEMPOTENT ROLLBACK: If external call failed and credits were debited
    // Use the SAME requestId for idempotency guarantee
    // Use authenticated client (RPC is SECURITY DEFINER, so it works)
    // ============================================
    if (creditsDebited && workspaceId && supabaseClient) {
      console.log(`Rolling back ${fetchCount} leads credits for workspace ${workspaceId}, requestId: ${requestId}`);
      
      try {
        // Use authenticated client instead of service role
        // add_credits RPC is SECURITY DEFINER, so it will execute with elevated privileges
        const { data: rollbackSuccess, error: rollbackError } = await supabaseClient.rpc('add_credits', {
          p_workspace_id: workspaceId,
          p_type: 'leads',
          p_amount: fetchCount,
          p_description: `Rollback: falha Apify - ${error.message}`,
          p_reference_id: requestId, // SAME requestId - ensures idempotency via ON CONFLICT DO NOTHING
        });

        if (rollbackError) {
          console.error('Rollback error:', rollbackError);
        } else if (rollbackSuccess) {
          console.log('Credits successfully rolled back');
        }
      } catch (rollbackErr) {
        console.error('Rollback exception:', rollbackErr);
      }
    }

    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
