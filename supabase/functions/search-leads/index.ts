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

    const body = await req.json();
    workspaceId = body.workspaceId;
    const { filters, onlyWithEmail } = body;
    fetchCount = body.fetch_count || 10;

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId is required' }), { status: 400, headers: corsHeaders });
    }

    // Verify workspace membership
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
    // EXTERNAL CALL: Call Apify API
    // If this fails, we need to rollback the credits
    // ============================================
    const APIFY_API_TOKEN = Deno.env.get('APIFY_API_TOKEN');
    if (!APIFY_API_TOKEN) {
      throw new Error('APIFY_API_TOKEN not configured');
    }

    const apifyResponse = await fetch(
      `https://api.apify.com/v2/acts/apify~linkedin-profile-scraper/runs?token=${APIFY_API_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [],
          searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(filters?.job_title || '')}${filters?.company ? `%20${encodeURIComponent(filters.company)}` : ''}`,
          maxResults: fetchCount,
        }),
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

    console.log('Apify run started:', { runId, requestId });

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
    // ============================================
    if (creditsDebited && workspaceId) {
      console.log(`Rolling back ${fetchCount} leads credits for workspace ${workspaceId}, requestId: ${requestId}`);
      
      try {
        const supabaseService = createClient(
          Deno.env.get('SUPABASE_URL')!,
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        );

        const { data: rollbackSuccess, error: rollbackError } = await supabaseService.rpc('add_credits', {
          p_workspace_id: workspaceId,
          p_type: 'leads',
          p_amount: fetchCount,
          p_description: `Rollback: falha Apify - ${error.message}`,
          p_reference_id: requestId, // SAME requestId - ensures idempotency
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
