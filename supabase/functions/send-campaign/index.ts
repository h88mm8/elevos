import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Message variable replacement (duplicated from frontend for edge function use)
const MESSAGE_VARIABLES = [
  { variable: '{{nome}}', field: 'full_name' },
  { variable: '{{primeiro_nome}}', field: 'first_name' },
  { variable: '{{sobrenome}}', field: 'last_name' },
  { variable: '{{email}}', field: 'email' },
  { variable: '{{celular}}', field: 'mobile_number' },
  { variable: '{{empresa}}', field: 'company' },
  { variable: '{{cargo}}', field: 'job_title' },
  { variable: '{{cidade}}', field: 'city' },
  { variable: '{{estado}}', field: 'state' },
  { variable: '{{pais}}', field: 'country' },
  { variable: '{{linkedin}}', field: 'linkedin_url' },
  { variable: '{{industria}}', field: 'industry' },
];

function replaceVariables(message: string, lead: Record<string, any>): string {
  let result = message;
  for (const { variable, field } of MESSAGE_VARIABLES) {
    const value = lead[field];
    result = result.split(variable).join(value ? String(value) : '');
  }
  return result;
}

interface CampaignLead {
  id: string;
  lead_id: string;
  status: string;
  lead: {
    id: string;
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
    mobile_number: string | null;
    phone: string | null;
    linkedin_url: string | null;
    company: string | null;
    job_title: string | null;
    city: string | null;
    state: string | null;
    country: string | null;
    industry: string | null;
  };
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

    const { campaignId } = await req.json();

    if (!campaignId) {
      return new Response(JSON.stringify({ error: 'Campaign ID is required' }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // GET CAMPAIGN WITH WORKSPACE VALIDATION
    // ============================================
    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .select('*')
      .eq('id', campaignId)
      .single();

    if (campaignError || !campaign) {
      console.error('Campaign not found:', campaignError);
      return new Response(JSON.stringify({ error: 'Campaign not found' }), { status: 404, headers: corsHeaders });
    }

    // Verify user has access to workspace (RLS should handle this, but double-check)
    const { data: memberCheck } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', campaign.workspace_id)
      .eq('user_id', claimsData.user.id)
      .single();

    if (!memberCheck) {
      return new Response(JSON.stringify({ error: 'Access denied to this campaign' }), { status: 403, headers: corsHeaders });
    }

    // ============================================
    // GET MESSAGING PROVIDER CREDENTIALS
    // ============================================
    const unipileDsn = Deno.env.get('UNIPILE_DSN');
    const unipileApiKey = Deno.env.get('UNIPILE_API_KEY');

    if (!unipileDsn || !unipileApiKey) {
      console.error('Messaging provider not configured');
      return new Response(JSON.stringify({ error: 'Messaging provider not configured' }), { status: 500, headers: corsHeaders });
    }

    // ============================================
    // VALIDATE ACCOUNT FOR WHATSAPP/LINKEDIN CAMPAIGNS
    // ============================================
    let accountId: string | null = null;

    if (campaign.type === 'whatsapp' || campaign.type === 'linkedin') {
      if (!campaign.account_id) {
        return new Response(JSON.stringify({ error: 'Account is required for WhatsApp/LinkedIn campaigns' }), { status: 400, headers: corsHeaders });
      }

      // Verify account belongs to workspace (campaign.account_id stores the internal UUID)
      const { data: account, error: accountError } = await supabase
        .from('accounts')
        .select('account_id, status')
        .eq('id', campaign.account_id)
        .eq('workspace_id', campaign.workspace_id)
        .single();

      if (accountError || !account) {
        console.error('Account not found or unauthorized:', accountError);
        return new Response(JSON.stringify({ error: 'Invalid or unauthorized account' }), { status: 400, headers: corsHeaders });
      }

      if (account.status !== 'connected') {
        return new Response(JSON.stringify({ error: 'Account is not connected. Please reconnect.' }), { status: 400, headers: corsHeaders });
      }

      accountId = account.account_id;
    }

    // ============================================
    // GET PENDING LEADS FOR THIS CAMPAIGN
    // ============================================
    const { data: campaignLeads, error: leadsError } = await supabase
      .from('campaign_leads')
      .select(`
        id,
        lead_id,
        status,
        lead:leads (
          id,
          full_name,
          first_name,
          last_name,
          email,
          mobile_number,
          phone,
          linkedin_url,
          company,
          job_title,
          city,
          state,
          country,
          industry
        )
      `)
      .eq('campaign_id', campaignId)
      .in('status', ['pending', 'failed']);

    if (leadsError) {
      console.error('Error fetching campaign leads:', leadsError);
      return new Response(JSON.stringify({ error: 'Failed to fetch campaign leads' }), { status: 500, headers: corsHeaders });
    }

    if (!campaignLeads || campaignLeads.length === 0) {
      return new Response(JSON.stringify({ error: 'No leads to send' }), { status: 400, headers: corsHeaders });
    }

    console.log(`Starting campaign ${campaignId} with ${campaignLeads.length} leads`);

    // Update campaign status to 'sending'
    await supabase
      .from('campaigns')
      .update({ status: 'sending' })
      .eq('id', campaignId);

    // ============================================
    // SEND MESSAGES TO EACH LEAD
    // ============================================
    let sentCount = 0;
    let failedCount = 0;
    const results: { leadId: string; success: boolean; error?: string }[] = [];

    for (const cl of campaignLeads as unknown as CampaignLead[]) {
      const lead = cl.lead;
      
      if (!lead) {
        console.error(`Lead not found for campaign_lead ${cl.id}`);
        failedCount++;
        results.push({ leadId: cl.lead_id, success: false, error: 'Lead not found' });
        continue;
      }

      // Replace variables in message
      const personalizedMessage = replaceVariables(campaign.message, lead);

      try {
        let sendSuccess = false;
        let sendError = '';

        if (campaign.type === 'whatsapp') {
          // Get phone number (prefer mobile_number, fallback to phone)
          const phoneNumber = lead.mobile_number || lead.phone;
          
          if (!phoneNumber) {
            throw new Error('No phone number available');
          }

          // Send via provider API by starting a new chat (works reliably for outbound campaigns)
          // WhatsApp attendee identifier format: "<digits>@s.whatsapp.net"
          const digits = String(phoneNumber).replace(/\D/g, '');
          if (!digits) {
            throw new Error('Invalid phone number');
          }

          const formData = new FormData();
          formData.append('account_id', accountId!);
          formData.append('text', personalizedMessage);
          formData.append('attendees_ids', `${digits}@s.whatsapp.net`);

          const response = await fetch(`https://${unipileDsn}/api/v1/chats`, {
            method: 'POST',
            headers: {
              'X-API-KEY': unipileApiKey,
              'Accept': 'application/json',
            },
            body: formData,
          });

          if (response.ok) {
            sendSuccess = true;
            console.log(`WhatsApp message sent to ${phoneNumber}`);
          } else {
            const errorText = await response.text().catch(() => '');
            sendError = errorText || `HTTP ${response.status}`;
            console.error(`Failed to send WhatsApp to ${phoneNumber}:`, sendError);
          }
        } else if (campaign.type === 'linkedin') {
          // LinkedIn requires attendees_ids (profile ID from linkedin_url)
          const linkedinUrl = lead.linkedin_url;
          
          if (!linkedinUrl) {
            throw new Error('No LinkedIn URL available');
          }

          // Extract LinkedIn ID from URL or use URL directly
          // Note: Unipile may need the internal profile ID, which we might not have
          // For now, we'll try with the URL - may need adjustment based on Unipile's requirements
          
          const formData = new FormData();
          formData.append('account_id', accountId!);
          formData.append('text', personalizedMessage);
          formData.append('attendees_ids', linkedinUrl); // May need profile ID
          formData.append('linkedin[api]', 'classic');

          const response = await fetch(`https://${unipileDsn}/api/v1/chats`, {
            method: 'POST',
            headers: {
              'X-API-KEY': unipileApiKey,
              'Accept': 'application/json',
            },
            body: formData,
          });

          if (response.ok) {
            sendSuccess = true;
            console.log(`LinkedIn message sent to ${linkedinUrl}`);
          } else {
            const errorData = await response.json().catch(() => ({}));
            sendError = errorData.message || `HTTP ${response.status}`;
            console.error(`Failed to send LinkedIn to ${linkedinUrl}:`, sendError);
          }
        } else if (campaign.type === 'email') {
          // Email sending would require a different provider (not Unipile)
          // For now, mark as not implemented
          sendError = 'Email sending not implemented yet';
          console.log('Email campaigns not yet implemented');
        } else if (campaign.type === 'sms') {
          // SMS would need a separate provider
          sendError = 'SMS sending not implemented yet';
          console.log('SMS campaigns not yet implemented');
        }

        // Update campaign_lead status
        if (sendSuccess) {
          await supabase
            .from('campaign_leads')
            .update({ status: 'sent', sent_at: new Date().toISOString() })
            .eq('id', cl.id);
          sentCount++;
          results.push({ leadId: cl.lead_id, success: true });
        } else {
          await supabase
            .from('campaign_leads')
            .update({ status: 'failed', error: sendError })
            .eq('id', cl.id);
          failedCount++;
          results.push({ leadId: cl.lead_id, success: false, error: sendError });
        }

        // Small delay between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 1000));

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error sending to lead ${cl.lead_id}:`, errorMessage);
        
        await supabase
          .from('campaign_leads')
          .update({ status: 'failed', error: errorMessage })
          .eq('id', cl.id);
        
        failedCount++;
        results.push({ leadId: cl.lead_id, success: false, error: errorMessage });
      }
    }

    // ============================================
    // UPDATE CAMPAIGN FINAL STATUS
    // ============================================
    const finalStatus = failedCount === campaignLeads.length ? 'failed' : 
                        sentCount === campaignLeads.length ? 'completed' : 'partial';

    await supabase
      .from('campaigns')
      .update({
        status: finalStatus,
        sent_count: campaign.sent_count + sentCount,
        failed_count: campaign.failed_count + failedCount,
      })
      .eq('id', campaignId);

    console.log(`Campaign ${campaignId} completed: ${sentCount} sent, ${failedCount} failed`);

    return new Response(JSON.stringify({
      success: true,
      campaignId,
      sentCount,
      failedCount,
      status: finalStatus,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in send-campaign:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
