import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LeadRecord {
  full_name: string | null;
  email: string | null;
  company: string | null;
  job_title: string | null;
  country: string | null;
  linkedin_url: string | null;
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
    // NO MOCK FALLBACK - return real errors
    // ============================================
    const APIFY_API_TOKEN = Deno.env.get('APIFY_API_TOKEN');
    if (!APIFY_API_TOKEN) {
      return new Response(JSON.stringify({ error: 'APIFY_API_TOKEN not configured' }), { status: 500, headers: corsHeaders });
    }

    // Get run status
    const runResponse = await fetch(
      `https://api.apify.com/v2/actor-runs/${runId}?token=${APIFY_API_TOKEN}`
    );

    // Return real Apify status (not hardcoded 404)
    if (!runResponse.ok) {
      console.error('Apify run error:', runId, runResponse.status);
      return new Response(
        JSON.stringify({ error: `Apify error: ${runId}`, apifyStatus: runResponse.status }),
        { status: runResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
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
      return new Response(
        JSON.stringify({ error: 'No dataset found for this run' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const datasetResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_TOKEN}`
    );

    if (!datasetResponse.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to get dataset: ${datasetResponse.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const datasetItems = await datasetResponse.json();
    console.log(`Retrieved ${datasetItems.length} items from Apify dataset`);

    // Transform Apify data to our lead format
    let leads: LeadRecord[] = datasetItems.map((item: Record<string, unknown>) => ({
      full_name: (item.fullName || item.name || item.full_name || null) as string | null,
      email: (item.email || null) as string | null,
      company: (item.companyName || item.company || null) as string | null,
      job_title: (item.title || item.jobTitle || item.job_title || null) as string | null,
      linkedin_url: (item.linkedinUrl || item.profileUrl || item.linkedin_url || null) as string | null,
      country: (item.location || item.country || null) as string | null,
      workspace_id: workspaceId,
    }));

    // Filter by email if requested
    if (onlyWithEmail) {
      leads = leads.filter((lead) => lead.email);
    }

    // Filter out leads without email (required for unique constraint)
    const leadsWithEmail = leads.filter((lead) => lead.email);
    const leadsWithoutEmail = leads.filter((lead) => !lead.email);

    console.log(`Processing ${leadsWithEmail.length} leads with email, ${leadsWithoutEmail.length} without`);

    let insertedLeads: LeadRecord[] = [];

    // ============================================
    // BATCH UPSERT: Leads WITH email using unique index (workspace_id, email)
    // ============================================
    if (leadsWithEmail.length > 0) {
      const { data: upsertedLeads, error: upsertError } = await supabase
        .from('leads')
        .upsert(leadsWithEmail, {
          onConflict: 'workspace_id,email',
          ignoreDuplicates: false,
        })
        .select();

      if (upsertError) {
        console.error('Error upserting leads with email:', upsertError);
        // Don't fail completely, continue with insert fallback
      } else {
        insertedLeads = upsertedLeads || [];
      }
    }

    // ============================================
    // SIMPLE INSERT: Leads WITHOUT email (no unique constraint applies)
    // ============================================
    if (leadsWithoutEmail.length > 0) {
      const { data: insertedNoEmail, error: insertError } = await supabase
        .from('leads')
        .insert(leadsWithoutEmail)
        .select();

      if (insertError) {
        console.error('Error inserting leads without email:', insertError);
      } else if (insertedNoEmail) {
        insertedLeads = [...insertedLeads, ...insertedNoEmail];
      }
    }

    return new Response(JSON.stringify({
      success: true,
      status: 'SUCCEEDED',
      leadsCount: insertedLeads.length,
      leads: insertedLeads,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in get-leads-results:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
