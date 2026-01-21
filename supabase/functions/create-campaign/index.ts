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
  mobile_number?: string | null;
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
    // MEMBERSHIP CHECK: Explicit verification via workspace_members table
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
    // VALIDATE ACCOUNT: If accountId provided, verify it belongs to workspace
    // ============================================
    if (accountId) {
      const { data: account, error: accountError } = await supabase
        .from('accounts')
        .select('id, channel, status')
        .eq('id', accountId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (accountError || !account) {
        return new Response(JSON.stringify({ 
          error: 'Invalid account: account not found or does not belong to this workspace' 
        }), { status: 400, headers: corsHeaders });
      }

      if (account.status !== 'connected') {
        return new Response(JSON.stringify({ 
          error: 'Account is not connected. Please reconnect the account.' 
        }), { status: 400, headers: corsHeaders });
      }

      // Validate channel matches campaign type
      if (type === 'whatsapp' && account.channel !== 'whatsapp') {
        return new Response(JSON.stringify({ 
          error: 'Selected account is not a WhatsApp account' 
        }), { status: 400, headers: corsHeaders });
      }
      if (type === 'linkedin' && account.channel !== 'linkedin') {
        return new Response(JSON.stringify({ 
          error: 'Selected account is not a LinkedIn account' 
        }), { status: 400, headers: corsHeaders });
      }
    }

    // Require accountId for WhatsApp and LinkedIn campaigns
    if ((type === 'whatsapp' || type === 'linkedin') && !accountId) {
      return new Response(JSON.stringify({ 
        error: `accountId is required for ${type} campaigns` 
      }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // FILTER LEADS: Only include valid leads for campaign type
    // ============================================
    const validLeads = (leads as LeadInput[]).filter((lead: LeadInput) => {
      if (type === 'email') return !!lead.email;
      if (type === 'sms' || type === 'whatsapp') return !!lead.mobile_number;
      if (type === 'linkedin') return !!lead.linkedin_url;
      return true; // For other types, include all
    });

    if (validLeads.length === 0) {
      return new Response(JSON.stringify({ 
        error: `No valid leads for campaign type "${type}". Leads need ${type === 'email' ? 'email' : type === 'linkedin' ? 'linkedin_url' : 'mobile_number (celular)'}` 
      }), { status: 400, headers: corsHeaders });
    }

    console.log(`Creating campaign with ${validLeads.length} valid leads (${leads.length} total provided)`);

    // ============================================
    // BATCH UPSERT LEADS: Single batch operation using unique index (workspace_id, email)
    // Separate leads with email (can upsert) from those without (simple insert)
    // ============================================
    const leadsWithEmail = validLeads.filter((lead: LeadInput) => lead.email);
    const leadsWithoutEmail = validLeads.filter((lead: LeadInput) => !lead.email && !lead.id);
    const leadsWithExistingIds = validLeads.filter((lead: LeadInput) => lead.id);

    let allLeadIds: string[] = [];

    // 1. Collect existing IDs from leads that already have them
    const existingIds = leadsWithExistingIds.map((lead: LeadInput) => lead.id as string);
    allLeadIds = [...existingIds];

    // 2. BATCH UPSERT: Leads with email using unique constraint
    if (leadsWithEmail.length > 0) {
      const leadsToUpsert = leadsWithEmail.map((lead: LeadInput) => ({
        workspace_id: workspaceId,
        email: lead.email,
        phone: lead.phone || null,
        linkedin_url: lead.linkedin_url || null,
        full_name: lead.full_name || null,
        company: lead.company || null,
        job_title: lead.job_title || null,
        country: lead.country || null,
      }));

      const { data: upsertedLeads, error: upsertError } = await supabase
        .from('leads')
        .upsert(leadsToUpsert, {
          onConflict: 'workspace_id,email',
          ignoreDuplicates: false,
        })
        .select('id');

      if (upsertError) {
        console.error('Error upserting leads with email:', upsertError);
        return new Response(JSON.stringify({ error: 'Failed to upsert leads', details: upsertError.message }), { status: 500, headers: corsHeaders });
      }

      if (upsertedLeads) {
        allLeadIds = [...allLeadIds, ...upsertedLeads.map(l => l.id)];
      }
    }

    // 3. SIMPLE INSERT: Leads without email (no unique constraint)
    if (leadsWithoutEmail.length > 0) {
      const leadsToInsert = leadsWithoutEmail.map((lead: LeadInput) => ({
        workspace_id: workspaceId,
        email: null,
        phone: lead.phone || null,
        linkedin_url: lead.linkedin_url || null,
        full_name: lead.full_name || null,
        company: lead.company || null,
        job_title: lead.job_title || null,
        country: lead.country || null,
      }));

      const { data: insertedLeads, error: insertError } = await supabase
        .from('leads')
        .insert(leadsToInsert)
        .select('id');

      if (insertError) {
        console.error('Error inserting leads without email:', insertError);
        // Continue - we might still have leads from upsert
      } else if (insertedLeads) {
        allLeadIds = [...allLeadIds, ...insertedLeads.map(l => l.id)];
      }
    }

    if (allLeadIds.length === 0) {
      return new Response(JSON.stringify({ error: 'Failed to process any leads' }), { status: 500, headers: corsHeaders });
    }

    // ============================================
    // CREATE CAMPAIGN: Using correct schema fields (message, subject, account_id)
    // ============================================
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert({
        workspace_id: workspaceId,
        name,
        type,
        message,  // Correct field name (not message_template)
        subject: type === 'email' ? subject : null,  // Include subject
        account_id: accountId || null,  // Include account_id
        schedule: schedule ? new Date(schedule).toISOString() : null,
        status: schedule ? 'scheduled' : 'draft',
        leads_count: allLeadIds.length,
      })
      .select()
      .single();

    if (campaignError) {
      console.error('Error creating campaign:', campaignError);
      return new Response(JSON.stringify({ error: 'Failed to create campaign', details: campaignError.message }), { status: 500, headers: corsHeaders });
    }

    // ============================================
    // BATCH INSERT CAMPAIGN_LEADS: Link all leads to campaign in single operation
    // ============================================
    const campaignLeads = allLeadIds.map(leadId => ({
      campaign_id: campaign.id,
      lead_id: leadId,
      status: 'pending',
    }));

    const { error: linkError } = await supabase
      .from('campaign_leads')
      .insert(campaignLeads);

    if (linkError) {
      console.error('Error linking leads to campaign:', linkError);
      // Campaign was created, so we don't fail completely but log the issue
    }

    console.log('Campaign created:', { id: campaign.id, leadsCount: allLeadIds.length });

    return new Response(JSON.stringify({
      success: true,
      campaign,
      linkedLeadsCount: allLeadIds.length,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in create-campaign:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
