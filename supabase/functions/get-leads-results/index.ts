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

    const { workspaceId, runId, onlyWithEmail, fetchCount } = await req.json();
    const limit = fetchCount || 50; // Default limit to prevent over-fetching

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
    const stats = runData.data?.stats || {};

    console.log('Apify run status:', { runId, status, stats });

    // If failed, return error immediately
    if (status === 'FAILED' || status === 'ABORTED' || status === 'TIMED-OUT') {
      return new Response(JSON.stringify({
        success: false,
        status,
        error: `Apify run ${status.toLowerCase()}`,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ============================================
    // FETCH DATASET: Even if RUNNING (partial results)
    // ============================================
    const datasetId = runData.data?.defaultDatasetId;
    if (!datasetId) {
      // No dataset yet - return progress only
      if (status === 'RUNNING' || status === 'READY') {
        return new Response(JSON.stringify({
          success: true,
          status,
          partial: true,
          message: 'Execução ainda em andamento...',
          leadsCount: 0,
          leads: [],
          progress: {
            totalItems: stats.totalItems || 0,
            itemsProcessed: stats.itemsProcessed || 0,
          },
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      return new Response(
        JSON.stringify({ error: 'No dataset found for this run' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Limit results from Apify dataset to prevent over-fetching
    const datasetResponse = await fetch(
      `https://api.apify.com/v2/datasets/${datasetId}/items?token=${APIFY_API_TOKEN}&limit=${limit}`
    );

    if (!datasetResponse.ok) {
      return new Response(
        JSON.stringify({ error: `Failed to get dataset: ${datasetResponse.status}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const datasetItems = await datasetResponse.json();
    console.log(`Retrieved ${datasetItems.length} items from Apify dataset`);

    // Transform Apify data to our lead format (using official field names from docs)
    let leads: LeadRecord[] = datasetItems.map((item: Record<string, unknown>) => ({
      full_name: (item.full_name || item.fullName || item.name || null) as string | null,
      email: (item.email || null) as string | null,
      company: (item.company_name || item.companyName || item.company || null) as string | null,
      job_title: (item.job_title || item.title || item.jobTitle || null) as string | null,
      linkedin_url: (item.linkedin || item.linkedinUrl || item.profileUrl || null) as string | null,
      country: (item.country || item.location || null) as string | null,
      workspace_id: workspaceId,
    }));

    // Filter by email if requested
    if (onlyWithEmail) {
      leads = leads.filter((lead) => lead.email);
    }

    // SAFETY LIMIT: Ensure we never exceed the requested fetchCount
    leads = leads.slice(0, limit);
    console.log(`Limited to ${leads.length} leads (limit: ${limit})`);

    const isPartial = status !== 'SUCCEEDED';

    // If partial and no leads yet, return progress
    if (isPartial && leads.length === 0) {
      return new Response(JSON.stringify({
        success: true,
        status,
        partial: true,
        message: 'Execução ainda em andamento...',
        leadsCount: 0,
        leads: [],
        progress: {
          totalItems: stats.totalItems || 0,
          itemsProcessed: stats.itemsProcessed || 0,
        },
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // Filter leads by email presence
    const leadsWithEmail = leads.filter((lead) => lead.email);
    const leadsWithoutEmail = leads.filter((lead) => !lead.email);

    console.log(`Processing ${leadsWithEmail.length} leads with email, ${leadsWithoutEmail.length} without`);

    let savedLeads: LeadRecord[] = [];
    let saveError: string | null = null;

    // ============================================
    // SMART INSERT: Check for duplicates first, then insert new leads only
    // ============================================
    if (leadsWithEmail.length > 0) {
      try {
        // Get existing emails in this workspace to avoid duplicates
        const emails = leadsWithEmail.map(l => l.email).filter(Boolean) as string[];
        const { data: existingLeads } = await supabase
          .from('leads')
          .select('email, linkedin_url')
          .eq('workspace_id', workspaceId)
          .in('email', emails);

        const existingEmails = new Set((existingLeads || []).map(e => e.email));
        
        // Filter only new leads (not already in database)
        const newLeads = leadsWithEmail.filter(l => l.email && !existingEmails.has(l.email));
        
        console.log(`Found ${existingEmails.size} existing leads, ${newLeads.length} new leads to insert`);

        if (newLeads.length > 0) {
          const { data: inserted, error: insertError } = await supabase
            .from('leads')
            .insert(newLeads)
            .select();

          if (insertError) {
            console.error('Error inserting new leads:', insertError);
            saveError = insertError.message;
          } else if (inserted) {
            savedLeads = inserted;
            console.log(`Successfully inserted ${inserted.length} new leads`);
          }
        }
      } catch (err) {
        console.error('Error in lead deduplication:', err);
        saveError = (err as Error).message;
      }
    }

    // ============================================
    // INSERT: Leads WITHOUT email (check linkedin_url for duplicates)
    // ============================================
    if (leadsWithoutEmail.length > 0) {
      try {
        // Get existing linkedin_urls to avoid duplicates
        const linkedinUrls = leadsWithoutEmail.map(l => l.linkedin_url).filter(Boolean) as string[];
        
        let newLeadsNoEmail = leadsWithoutEmail;
        
        if (linkedinUrls.length > 0) {
          const { data: existingByLinkedin } = await supabase
            .from('leads')
            .select('linkedin_url')
            .eq('workspace_id', workspaceId)
            .in('linkedin_url', linkedinUrls);

          const existingLinkedins = new Set((existingByLinkedin || []).map(e => e.linkedin_url));
          newLeadsNoEmail = leadsWithoutEmail.filter(l => !l.linkedin_url || !existingLinkedins.has(l.linkedin_url));
        }

        if (newLeadsNoEmail.length > 0) {
          const { data: insertedNoEmail, error: insertError } = await supabase
            .from('leads')
            .insert(newLeadsNoEmail)
            .select();

          if (insertError) {
            console.error('Error inserting leads without email:', insertError);
          } else if (insertedNoEmail) {
            savedLeads = [...savedLeads, ...insertedNoEmail];
            console.log(`Successfully inserted ${insertedNoEmail.length} leads without email`);
          }
        }
      } catch (err) {
        console.error('Error inserting leads without email:', err);
      }
    }

    // ============================================
    // RESPONSE: Return ALL processed leads, even if save failed
    // This ensures UI shows results even on DB errors
    // ============================================
    const responseLeads = savedLeads.length > 0 ? savedLeads : leads;
    const responseCount = savedLeads.length > 0 ? savedLeads.length : leads.length;

    return new Response(JSON.stringify({
      success: true,
      status,
      partial: isPartial,
      message: isPartial ? 'Resultados parciais disponíveis' : 'Execução concluída',
      leadsCount: responseCount,
      leads: responseLeads,
      savedCount: savedLeads.length,
      totalProcessed: leads.length,
      warning: saveError ? `Alguns leads podem não ter sido salvos: ${saveError}` : undefined,
      progress: {
        totalItems: stats.totalItems || 0,
        itemsProcessed: stats.itemsProcessed || 0,
      },
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in get-leads-results:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});