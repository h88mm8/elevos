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

    const { workspaceId, filters, fetch_count, onlyWithEmail } = await req.json();

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

    // Check credits
    const { data: credits } = await supabase
      .from('credits')
      .select('leads_credits')
      .eq('workspace_id', workspaceId)
      .single();

    if (!credits || credits.leads_credits < fetch_count) {
      return new Response(JSON.stringify({ error: 'Insufficient credits', code: 402 }), { status: 402, headers: corsHeaders });
    }

    // Call Apify API
    const APIFY_API_TOKEN = Deno.env.get('APIFY_API_TOKEN');
    const apifyResponse = await fetch(
      `https://api.apify.com/v2/acts/apify~linkedin-profile-scraper/runs?token=${APIFY_API_TOKEN}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [],
          searchUrl: `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(filters?.job_title || '')}${filters?.company ? `%20${encodeURIComponent(filters.company)}` : ''}`,
          maxResults: fetch_count,
        }),
      }
    );

    const apifyData = await apifyResponse.json();
    console.log('Apify run started:', apifyData);

    return new Response(JSON.stringify({
      success: true,
      runId: apifyData.data?.id || 'mock-run-id',
      message: 'Lead search started',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error in search-leads:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
