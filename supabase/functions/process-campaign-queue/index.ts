import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Message variable replacement
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

// Apply jitter to interval (±20% randomization)
function applyJitter(baseSeconds: number, minSeconds: number = 10): number {
  const jitterFactor = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
  const jitteredValue = Math.round(baseSeconds * jitterFactor);
  return Math.max(jitteredValue, minSeconds);
}

interface CampaignLead {
  id: string;
  lead_id: string;
  status: string;
  retry_count: number;
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

interface WorkspaceSettings {
  // WhatsApp settings
  daily_message_limit: number;
  message_interval_seconds: number;
  max_retries: number;
  // LinkedIn settings
  linkedin_daily_message_limit: number;
  linkedin_daily_invite_limit: number;
  linkedin_message_interval_seconds: number;
}

const DEFAULT_SETTINGS: WorkspaceSettings = {
  // WhatsApp defaults
  daily_message_limit: 50,
  message_interval_seconds: 15,
  max_retries: 3,
  // LinkedIn defaults
  linkedin_daily_message_limit: 50,
  linkedin_daily_invite_limit: 25,
  linkedin_message_interval_seconds: 30,
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    const today = new Date().toISOString().split('T')[0];
    console.log(`Processing campaign queue for ${today}`);

    // ============================================
    // GET QUEUED ITEMS FOR TODAY
    // ============================================
    const { data: queueItems, error: queueError } = await supabase
      .from('campaign_queue')
      .select('*')
      .eq('scheduled_date', today)
      .eq('status', 'queued')
      .order('created_at', { ascending: true });

    if (queueError) {
      console.error('Error fetching queue:', queueError);
      return new Response(JSON.stringify({ error: 'Failed to fetch queue' }), { status: 500, headers: corsHeaders });
    }

    if (!queueItems || queueItems.length === 0) {
      console.log('No queued items for today');
      return new Response(JSON.stringify({ success: true, message: 'No items to process' }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    console.log(`Found ${queueItems.length} queue items to process`);

    const unipileDsn = Deno.env.get('UNIPILE_DSN');
    const unipileApiKey = Deno.env.get('UNIPILE_API_KEY');

    if (!unipileDsn || !unipileApiKey) {
      console.error('Messaging provider not configured');
      return new Response(JSON.stringify({ error: 'Messaging provider not configured' }), { status: 500, headers: corsHeaders });
    }

    const processedCampaigns: { campaignId: string; sentCount: number; failedCount: number }[] = [];

    for (const queueItem of queueItems) {
      console.log(`Processing queue item ${queueItem.id} for campaign ${queueItem.campaign_id}`);

      // Mark as processing
      await supabase
        .from('campaign_queue')
        .update({ status: 'processing' })
        .eq('id', queueItem.id);

      // Get campaign
      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', queueItem.campaign_id)
        .single();

      if (campaignError || !campaign) {
        console.error(`Campaign ${queueItem.campaign_id} not found`);
        await supabase
          .from('campaign_queue')
          .update({ status: 'completed', processed_at: new Date().toISOString() })
          .eq('id', queueItem.id);
        continue;
      }

      // Get workspace settings (including LinkedIn)
      const { data: workspaceSettings } = await supabase
        .from('workspace_settings')
        .select('daily_message_limit, message_interval_seconds, max_retries, linkedin_daily_message_limit, linkedin_daily_invite_limit, linkedin_message_interval_seconds')
        .eq('workspace_id', campaign.workspace_id)
        .maybeSingle();

      const settings: WorkspaceSettings = {
        ...DEFAULT_SETTINGS,
        ...workspaceSettings,
      };

      // Select channel-specific settings
      const isLinkedIn = campaign.type === 'linkedin';
      const baseIntervalSeconds = isLinkedIn ? settings.linkedin_message_interval_seconds : settings.message_interval_seconds;
      const minIntervalSeconds = isLinkedIn ? 10 : 10; // Both have 10s minimum

      console.log(`Using ${isLinkedIn ? 'LinkedIn' : 'WhatsApp'} settings: ${baseIntervalSeconds}s base interval (with ±20% jitter)`);

      // Get account for WhatsApp/LinkedIn
      let accountId: string | null = null;
      if (campaign.type === 'whatsapp' || campaign.type === 'linkedin') {
        const { data: account } = await supabase
          .from('accounts')
          .select('account_id, status')
          .eq('id', campaign.account_id)
          .single();

        if (!account || account.status !== 'connected') {
          console.error(`Account not available for campaign ${campaign.id}`);
          await supabase
            .from('campaign_queue')
            .update({ status: 'completed', processed_at: new Date().toISOString() })
            .eq('id', queueItem.id);
          continue;
        }
        accountId = account.account_id;
      }

      // Get pending leads (including failed with retry_count < max_retries)
      const { data: campaignLeads, error: leadsError } = await supabase
        .from('campaign_leads')
        .select(`
          id,
          lead_id,
          status,
          retry_count,
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
        .eq('campaign_id', campaign.id)
        .or(`status.eq.pending,and(status.eq.failed,retry_count.lt.${settings.max_retries})`)
        .limit(queueItem.leads_to_send);

      if (leadsError || !campaignLeads || campaignLeads.length === 0) {
        console.log(`No leads to send for campaign ${campaign.id}`);
        await supabase
          .from('campaign_queue')
          .update({ status: 'completed', leads_sent: 0, processed_at: new Date().toISOString() })
          .eq('id', queueItem.id);
        continue;
      }

      // Update campaign status
      await supabase
        .from('campaigns')
        .update({ status: 'sending' })
        .eq('id', campaign.id);

      let sentCount = 0;
      let failedCount = 0;

      // Send messages
      for (let i = 0; i < campaignLeads.length; i++) {
        const cl = campaignLeads[i] as unknown as CampaignLead;
        const lead = cl.lead;

        if (!lead) {
          failedCount++;
          continue;
        }

        const personalizedMessage = replaceVariables(campaign.message, lead);

        try {
          let sendSuccess = false;
          let sendError = '';
          let providerMessageId: string | null = null;

          if (campaign.type === 'whatsapp') {
            const phoneNumber = lead.mobile_number || lead.phone;
            if (!phoneNumber) throw new Error('No phone number');

            const digits = String(phoneNumber).replace(/\D/g, '');
            if (!digits) throw new Error('Invalid phone number');

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
              const responseData = await response.json().catch(() => ({}));
              if (responseData.message_id || responseData.id) {
                providerMessageId = responseData.message_id || responseData.id;
              }
            } else {
              sendError = await response.text().catch(() => `HTTP ${response.status}`);
            }
          } else if (campaign.type === 'linkedin') {
            const linkedinUrl = lead.linkedin_url;
            if (!linkedinUrl) throw new Error('No LinkedIn URL');

            const formData = new FormData();
            formData.append('account_id', accountId!);
            formData.append('text', personalizedMessage);
            formData.append('attendees_ids', linkedinUrl);
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
              const responseData = await response.json().catch(() => ({}));
              if (responseData.message_id || responseData.id) {
                providerMessageId = responseData.message_id || responseData.id;
              }
            } else {
              const errorData = await response.json().catch(() => ({}));
              sendError = errorData.message || `HTTP ${response.status}`;
            }
          }

          if (sendSuccess) {
            const updateData: Record<string, any> = { 
              status: 'sent', 
              sent_at: new Date().toISOString(),
              retry_count: cl.retry_count, // Keep current count
            };
            if (providerMessageId) {
              updateData.provider_message_id = providerMessageId;
            }
            await supabase
              .from('campaign_leads')
              .update(updateData)
              .eq('id', cl.id);
            sentCount++;
          } else {
            const newRetryCount = cl.retry_count + 1;
            const isFinalFailure = newRetryCount >= settings.max_retries;
            await supabase
              .from('campaign_leads')
              .update({ 
                status: 'failed', 
                error: sendError,
                retry_count: newRetryCount,
              })
              .eq('id', cl.id);
            failedCount++;
            console.log(`Lead ${cl.lead_id} failed (attempt ${newRetryCount}/${settings.max_retries})${isFinalFailure ? ' - no more retries' : ''}`);
          }

          // Apply jitter to interval (±20% randomization) for more natural sending pattern
          if (i < campaignLeads.length - 1) {
            const delaySeconds = applyJitter(baseIntervalSeconds, minIntervalSeconds);
            console.log(`Waiting ${delaySeconds}s before next message (base: ${baseIntervalSeconds}s)`);
            await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const newRetryCount = cl.retry_count + 1;
          const isFinalFailure = newRetryCount >= settings.max_retries;
          await supabase
            .from('campaign_leads')
            .update({ 
              status: 'failed', 
              error: errorMessage,
              retry_count: newRetryCount,
            })
            .eq('id', cl.id);
          failedCount++;
          console.log(`Lead ${cl.lead_id} exception (attempt ${newRetryCount}/${settings.max_retries})${isFinalFailure ? ' - no more retries' : ''}`);
        }
      }

      // Update queue item
      await supabase
        .from('campaign_queue')
        .update({ 
          status: 'completed', 
          leads_sent: sentCount,
          processed_at: new Date().toISOString() 
        })
        .eq('id', queueItem.id);

      // Check for more queued items
      const { data: remainingQueue } = await supabase
        .from('campaign_queue')
        .select('id')
        .eq('campaign_id', campaign.id)
        .eq('status', 'queued');

      const hasMoreInQueue = remainingQueue && remainingQueue.length > 0;

      // Update campaign status
      let finalStatus: string;
      if (hasMoreInQueue) {
        finalStatus = 'queued';
      } else {
        // Check if all leads are processed
        const { data: pendingLeads } = await supabase
          .from('campaign_leads')
          .select('id')
          .eq('campaign_id', campaign.id)
          .eq('status', 'pending');

        if (pendingLeads && pendingLeads.length > 0) {
          finalStatus = 'partial';
        } else {
          finalStatus = 'completed';
        }
      }

      await supabase
        .from('campaigns')
        .update({
          status: finalStatus,
          sent_count: campaign.sent_count + sentCount,
          failed_count: campaign.failed_count + failedCount,
        })
        .eq('id', campaign.id);

      processedCampaigns.push({ campaignId: campaign.id, sentCount, failedCount });
      console.log(`Campaign ${campaign.id}: ${sentCount} sent, ${failedCount} failed`);
    }

    return new Response(JSON.stringify({
      success: true,
      processedCampaigns,
      date: today,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in process-campaign-queue:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
