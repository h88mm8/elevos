import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface LeadInput {
  id?: string;
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  full_name?: string | null;
  company?: string | null;
  job_title?: string | null;
  country?: string | null;
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

    const { workspaceId, name, type, leads, message, subject, accountId, schedule } = await req.json();

    if (!workspaceId || !name || !type || !message || !leads?.length) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400, headers: corsHeaders });
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
    // FILTER LEADS: Only include valid leads for campaign type
    // ============================================
    const validLeads = (leads as LeadInput[]).filter((lead: LeadInput) => {
      if (type === 'email') return !!lead.email;
      if (type === 'sms' || type === 'whatsapp') return !!lead.phone;
      if (type === 'linkedin') return !!lead.linkedin_url;
      return true; // For other types, include all
    });

    if (validLeads.length === 0) {
      return new Response(JSON.stringify({ 
        error: `No valid leads for campaign type "${type}". Leads need ${type === 'email' ? 'email' : type === 'linkedin' ? 'linkedin_url' : 'phone'}` 
      }), { status: 400, headers: corsHeaders });
    }

    console.log(`Creating campaign with ${validLeads.length} valid leads (${leads.length} total provided)`);

    // ============================================
    // BATCH UPSERT LEADS: Create or update leads in database
    // ============================================
    const leadsToUpsert = validLeads.map((lead: LeadInput) => ({
      id: lead.id, // Keep existing ID if provided
      workspace_id: workspaceId,
      email: lead.email || null,
      phone: lead.phone || null,
      linkedin_url: lead.linkedin_url || null,
      full_name: lead.full_name || null,
      company: lead.company || null,
      job_title: lead.job_title || null,
      country: lead.country || null,
    }));

    // Get or create lead IDs
    let leadIds: string[] = [];
    
    // First, get IDs for leads that already have them
    const existingIds = validLeads
      .filter((lead: LeadInput) => lead.id)
      .map((lead: LeadInput) => lead.id as string);
    
    // For leads without IDs, we need to insert/upsert them
    const leadsWithoutIds = leadsToUpsert.filter(lead => !lead.id);
    
    if (leadsWithoutIds.length > 0) {
      const { data: insertedLeads, error: insertError } = await supabase
        .from('leads')
        .insert(leadsWithoutIds.map(lead => {
          const { id, ...rest } = lead;
          return rest;
        }))
        .select('id');

      if (insertError) {
        console.error('Error inserting leads:', insertError);
        // Continue with existing IDs only
      } else if (insertedLeads) {
        leadIds = [...existingIds, ...insertedLeads.map(l => l.id)];
      }
    } else {
      leadIds = existingIds;
    }

    if (leadIds.length === 0) {
      // Try to use the IDs from existing leads if available
      leadIds = validLeads
        .filter((lead: LeadInput) => lead.id)
        .map((lead: LeadInput) => lead.id as string);
    }

    // ============================================
    // CREATE CAMPAIGN
    // ============================================
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert({
        workspace_id: workspaceId,
        name,
        type,
        message,
        subject: type === 'email' ? subject : null,
        account_id: accountId || null,
        schedule: schedule ? new Date(schedule).toISOString() : null,
        status: schedule ? 'scheduled' : 'draft',
        leads_count: leadIds.length,
      })
      .select()
      .single();

    if (campaignError) {
      console.error('Error creating campaign:', campaignError);
      return new Response(JSON.stringify({ error: 'Failed to create campaign', details: campaignError.message }), { status: 500, headers: corsHeaders });
    }

    // ============================================
    // CREATE CAMPAIGN_LEADS: Link leads to campaign in batch
    // ============================================
    if (leadIds.length > 0) {
      const campaignLeads = leadIds.map(leadId => ({
        campaign_id: campaign.id,
        lead_id: leadId,
        status: 'pending',
      }));

      const { error: linkError } = await supabase
        .from('campaign_leads')
        .insert(campaignLeads);

      if (linkError) {
        console.error('Error linking leads to campaign:', linkError);
        // Campaign was created, so we don't fail completely
      }
    }

    console.log('Campaign created:', { id: campaign.id, leadsCount: leadIds.length });

    return new Response(JSON.stringify({
      success: true,
      campaign,
      linkedLeadsCount: leadIds.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in create-campaign:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
