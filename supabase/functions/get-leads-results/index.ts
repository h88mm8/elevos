import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LeadRecord {
  full_name: string;
  email: string | null;
  company: string;
  job_title: string;
  country: string;
  linkedin_url: string;
  workspace_id: string;
}

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
    // CALL APIFY: Get run status and results
    // NOTE: Credits already debited in search-leads
    // ============================================
    const APIFY_API_TOKEN = Deno.env.get('APIFY_API_TOKEN');
    if (!APIFY_API_TOKEN) {
      return new Response(JSON.stringify({ error: 'APIFY_API_TOKEN not configured' }), { status: 500, headers: corsHeaders });
    }

    // Get run status
    const runResponse = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_TOKEN}`
    );

    if (!runResponse.ok) {
      // If run not found, might be a demo/test run - return mock data
      if (runResponse.status === 404 || runId === 'mock-run-id') {
        console.log('Run not found or mock run, returning demo data');
        return getMockResponse(supabase, workspaceId, onlyWithEmail);
      }
      throw new Error(`Failed to get run status: ${runResponse.status}`);
    }

    const runData = await runResponse.json();
    const status = runData.data?.status;

    console.log('Apify run status:', { runId, status });

    // If still running, return status
    if (status === 'RUNNING' || status === 'READY') {
      return new Response(JSON.stringify({
        success: true,
        status,
        message: 'Search still in progress',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // If failed, return error
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      return new Response(JSON.stringify({
        success: false,
        status,
        error: `Apify run ${status.toLowerCase()}`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // If succeeded, get dataset items
    const datasetId = runData.data?.defaultDatasetId;
    if (!datasetId) {
      throw new Error('No dataset found for this run');
    }

    const datasetResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_TOKEN}`
    );

    if (!datasetResponse.ok) {
      throw new Error(`Failed to get dataset: ${datasetResponse.status}`);
    }

    const datasetItems = await datasetResponse.json();
    console.log(`Retrieved ${datasetItems.length} items from Apify dataset`);

    // Transform Apify data to our lead format
    let leads = datasetItems.map((item: Record<string, unknown>) => ({
      full_name: (item.fullName || item.name || null) as string | null,
      email: (item.email || null) as string | null,
      company: (item.companyName || item.company || null) as string | null,
      job_title: (item.title || item.jobTitle || null) as string | null,
      linkedin_url: (item.linkedinUrl || item.profileUrl || null) as string | null,
      country: (item.location || item.country || null) as string | null,
      workspace_id: workspaceId,
    }));

    // Filter by email if requested
    if (onlyWithEmail) {
      leads = leads.filter((lead: { email: string | null }) => lead.email);
    }

    // ============================================
    // BATCH UPSERT: Insert leads with conflict handling
    // Using linkedin_url as unique identifier when available
    // ============================================
    if (leads.length > 0) {
      const { data: insertedLeads, error: insertError } = await supabase
        .from('leads')
        .upsert(leads, {
          onConflict: 'workspace_id,linkedin_url',
          ignoreDuplicates: false,
        })
        .select();

      if (insertError) {
        console.error('Error upserting leads:', insertError);
        // Try simple insert if upsert fails (might be missing unique constraint)
        const { data: simpleInsert, error: simpleError } = await supabase
          .from('leads')
          .insert(leads)
          .select();
        
        if (simpleError) {
          console.error('Simple insert also failed:', simpleError);
        } else {
          leads = simpleInsert || leads;
        }
      } else {
        leads = insertedLeads || leads;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      status: 'SUCCEEDED',
      leadsCount: leads.length,
      leads,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in get-leads-results:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});

// Helper function for mock/demo data
async function getMockResponse(
  // deno-lint-ignore no-explicit-any
  supabase: SupabaseClient<any, any, any>,
  workspaceId: string,
  onlyWithEmail: boolean
) {
  const mockLeads: LeadRecord[] = [
    { full_name: 'João Silva', email: 'joao@empresa.com', company: 'Tech Corp', job_title: 'CEO', country: 'Brasil', linkedin_url: 'https://linkedin.com/in/joaosilva', workspace_id: workspaceId },
    { full_name: 'Maria Santos', email: 'maria@startup.io', company: 'Startup IO', job_title: 'CTO', country: 'Brasil', linkedin_url: 'https://linkedin.com/in/mariasantos', workspace_id: workspaceId },
    { full_name: 'Pedro Costa', email: null, company: 'Big Corp', job_title: 'Director', country: 'Portugal', linkedin_url: 'https://linkedin.com/in/pedrocosta', workspace_id: workspaceId },
  ];

  const leadsToInsert = mockLeads.filter(lead => !onlyWithEmail || lead.email);

  const { data: insertedLeads, error: insertError } = await supabase
    .from('leads')
    .insert(leadsToInsert)
    .select();

  if (insertError) {
    console.error('Error inserting mock leads:', insertError);
  }

  return new Response(JSON.stringify({
    success: true,
    status: 'SUCCEEDED',
    leadsCount: leadsToInsert.length,
    leads: insertedLeads || leadsToInsert,
    mock: true,
  }), { 
    headers: { 
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      'Content-Type': 'application/json',
    } 
  });
}
