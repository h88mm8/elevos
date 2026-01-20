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

    const { workspaceId, runId, onlyWithEmail } = await req.json();

    if (!workspaceId || !runId) {
      return new Response(JSON.stringify({ error: 'workspaceId and runId are required' }), { status: 400, headers: corsHeaders });
    }

    // For demo purposes, return mock data
    // In production, you'd poll Apify for results
    const mockLeads = [
      { full_name: 'João Silva', email: 'joao@empresa.com', company: 'Tech Corp', job_title: 'CEO', country: 'Brasil' },
      { full_name: 'Maria Santos', email: 'maria@startup.io', company: 'Startup IO', job_title: 'CTO', country: 'Brasil' },
    ];

    // Insert leads into database
    const leadsToInsert = mockLeads.map(lead => ({
      ...lead,
      workspace_id: workspaceId,
    }));

    const { data: insertedLeads, error: insertError } = await supabase
      .from('leads')
      .insert(leadsToInsert)
      .select();

    if (insertError) {
      console.error('Error inserting leads:', insertError);
    }

    // Deduct credits - get current credits first then update
    const { data: currentCredits } = await supabase
      .from('credits')
      .select('leads_credits')
      .eq('workspace_id', workspaceId)
      .single();

    if (currentCredits) {
      await supabase
        .from('credits')
        .update({ leads_credits: currentCredits.leads_credits - mockLeads.length })
        .eq('workspace_id', workspaceId);

      // Log credit usage
      await supabase.from('credit_history').insert({
        workspace_id: workspaceId,
        type: 'lead_search',
        amount: -mockLeads.length,
        description: `Busca de ${mockLeads.length} leads`,
        reference_id: runId,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      status: 'SUCCEEDED',
      leadsCount: mockLeads.length,
      leads: insertedLeads || leadsToInsert,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in get-leads-results:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
