import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============================================
// MESSAGE VARIABLE REPLACEMENT
// ============================================
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

// ============================================
// UTILITIES
// ============================================
function applyJitter(baseSeconds: number, minSeconds: number = 10): number {
  const jitterFactor = 0.8 + Math.random() * 0.4;
  const jitteredValue = Math.round(baseSeconds * jitterFactor);
  return Math.max(jitteredValue, minSeconds);
}

function getTodayDateInTimezone(timezone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    return `${year}-${month}-${day}`;
  } catch {
    return new Date().toISOString().split('T')[0];
  }
}

// ============================================
// TYPES
// ============================================
interface ClaimedQueueEntry {
  queue_id: string;
  campaign_id: string;
  workspace_id: string;
  scheduled_date: string;
  leads_to_send: number;
  leads_sent: number;
  workspace_timezone: string;
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
  daily_message_limit: number;
  message_interval_seconds: number;
  max_retries: number;
  linkedin_daily_message_limit: number;
  linkedin_daily_invite_limit: number;
  linkedin_message_interval_seconds: number;
}

const DEFAULT_SETTINGS: WorkspaceSettings = {
  daily_message_limit: 50,
  message_interval_seconds: 15,
  max_retries: 3,
  linkedin_daily_message_limit: 50,
  linkedin_daily_invite_limit: 25,
  linkedin_message_interval_seconds: 30,
};

type UsageAction = 'linkedin_message' | 'linkedin_invite' | 'whatsapp_message';

interface ProcessResult {
  queueId: string;
  campaignId: string;
  workspaceId: string;
  scheduledDate: string;
  leadsToSend: number;
  leadsSentBefore: number;
  sentNow: number;
  failedNow: number;
  remaining: number;
  finalStatus: string;
}

// ============================================
// HELPER: Finalize Campaign Status (Source of Truth)
// ============================================
// Rules:
// 1. If any campaign_queue entry exists with status='queued' and leads_sent < leads_to_send => 'queued'
// 2. If any campaign_leads with status='pending' => 'queued' (work remaining)
// 3. Otherwise => 'completed'
async function finalizeCampaignStatus(supabaseClient: any, campaignId: string): Promise<string> {
  console.log(`[finalizeCampaignStatus] Checking campaign ${campaignId}...`);
  
  // Step 1: Check for pending queue entries
  const { data: queueEntries, error: queueError } = await supabaseClient
    .from('campaign_queue')
    .select('id, leads_to_send, leads_sent')
    .eq('campaign_id', campaignId)
    .eq('status', 'queued');
  
  if (queueError) {
    console.error(`[finalizeCampaignStatus] Error checking queue:`, queueError);
  }
  
  const hasPendingQueue = queueEntries && queueEntries.some(
    (q: { leads_to_send: number; leads_sent: number }) => q.leads_sent < q.leads_to_send
  );
  
  if (hasPendingQueue) {
    console.log(`[finalizeCampaignStatus] Campaign ${campaignId} has pending queue entries -> queued`);
    await supabaseClient
      .from('campaigns')
      .update({ status: 'queued', updated_at: new Date().toISOString() })
      .eq('id', campaignId);
    return 'queued';
  }
  
  // Step 2: Check for pending leads
  const { count: pendingCount, error: pendingError } = await supabaseClient
    .from('campaign_leads')
    .select('id', { count: 'exact', head: true })
    .eq('campaign_id', campaignId)
    .eq('status', 'pending');
  
  if (pendingError) {
    console.error(`[finalizeCampaignStatus] Error checking pending leads:`, pendingError);
  }
  
  if (pendingCount && pendingCount > 0) {
    console.log(`[finalizeCampaignStatus] Campaign ${campaignId} has ${pendingCount} pending leads -> queued`);
    await supabaseClient
      .from('campaigns')
      .update({ status: 'queued', updated_at: new Date().toISOString() })
      .eq('id', campaignId);
    return 'queued';
  }
  
  // Step 3: No pending work -> completed
  console.log(`[finalizeCampaignStatus] Campaign ${campaignId} has no pending work -> completed`);
  await supabaseClient
    .from('campaigns')
    .update({ status: 'completed', updated_at: new Date().toISOString() })
    .eq('id', campaignId);
  return 'completed';
}

// ============================================
// LINKEDIN HELPERS
// ============================================
function extractLinkedInPublicIdentifier(linkedinUrl: string): string | null {
  try {
    const url = linkedinUrl.startsWith('http') 
      ? new URL(linkedinUrl) 
      : new URL(`https://linkedin.com${linkedinUrl.startsWith('/') ? '' : '/'}${linkedinUrl}`);
    const pathParts = url.pathname.split('/').filter(Boolean);
    const inIndex = pathParts.findIndex(p => p.toLowerCase() === 'in');
    if (inIndex !== -1 && pathParts[inIndex + 1]) {
      return pathParts[inIndex + 1];
    }
    return pathParts[pathParts.length - 1] || null;
  } catch {
    const match = linkedinUrl.match(/\/in\/([^\/\?]+)/);
    return match ? match[1] : null;
  }
}

async function resolveLinkedInProviderId(
  unipileDsn: string,
  unipileApiKey: string,
  accountId: string,
  publicIdentifier: string
): Promise<string | null> {
  try {
    const lookupUrl = `https://${unipileDsn}/api/v1/users/${encodeURIComponent(publicIdentifier)}?account_id=${accountId}`;
    console.log(`[LinkedIn Lookup] URL: ${lookupUrl}`);
    
    const response = await fetch(lookupUrl, {
      method: 'GET',
      headers: {
        'X-API-KEY': unipileApiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`[LinkedIn Lookup] Failed for ${publicIdentifier}: HTTP ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    console.log(`[LinkedIn Lookup] Response for ${publicIdentifier}:`, JSON.stringify({
      id: data.id,
      provider_id: data.provider_id,
      provider_messaging_id: data.provider_messaging_id,
    }));
    
    // IMPORTANT: Use provider_id or id for invite endpoint
    // DO NOT use provider_messaging_id - it doesn't work for /users/invite
    const providerId = data.provider_id || data.id;
    
    if (!providerId) {
      console.error(`[LinkedIn Lookup] No valid provider_id found for ${publicIdentifier}. Available fields: ${Object.keys(data).join(', ')}`);
      return null;
    }
    
    // Validate that we're not returning provider_messaging_id by mistake
    if (providerId === data.provider_messaging_id && !data.provider_id && !data.id) {
      console.error(`[LinkedIn Lookup] Only provider_messaging_id available for ${publicIdentifier}, which doesn't work for invites`);
      return null;
    }
    
    console.log(`[LinkedIn Lookup] Resolved ${publicIdentifier} -> provider_id: ${providerId}`);
    return providerId;
  } catch (error) {
    console.error(`[LinkedIn Lookup] Error for ${publicIdentifier}:`, error);
    return null;
  }
}

// ============================================
// MAIN HANDLER
// ============================================
serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  try {
    // Parse request body (optional parameters)
    let workspaceId: string | null = null;
    let limit = 25;
    let dryRun = false;

    try {
      const body = await req.json();
      workspaceId = body.workspaceId || null;
      limit = body.limit ?? 25;
      dryRun = body.dryRun === true;
    } catch {
      // No body or invalid JSON - use defaults
    }

    console.log(`[process-campaign-queue] Starting. workspaceId=${workspaceId || 'all'}, limit=${limit}, dryRun=${dryRun}`);

    // ============================================
    // CLAIM DUE QUEUE ENTRIES (atomic)
    // ============================================
    const { data: claimedEntries, error: claimError } = await supabase
      .rpc('claim_due_queue_entries', {
        p_workspace_id: workspaceId,
        p_limit: limit,
      });

    if (claimError) {
      console.error('Error claiming queue entries:', claimError);
      return new Response(JSON.stringify({ error: 'Failed to claim queue entries', details: claimError.message }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const entries = (claimedEntries || []) as ClaimedQueueEntry[];

    if (entries.length === 0) {
      console.log('[process-campaign-queue] No due queue entries found');
      return new Response(JSON.stringify({ 
        success: true, 
        message: 'No items to process',
        processed: [],
        dryRun,
      }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    console.log(`[process-campaign-queue] Claimed ${entries.length} queue entries`);

    // DRY RUN: Just return what would be processed
    if (dryRun) {
      // Release claimed entries back to queued
      for (const entry of entries) {
        await supabase
          .from('campaign_queue')
          .update({ status: 'queued' })
          .eq('id', entry.queue_id);
      }

      const dryRunResults = entries.map(e => ({
        queueId: e.queue_id,
        campaignId: e.campaign_id,
        workspaceId: e.workspace_id,
        scheduledDate: e.scheduled_date,
        leadsToSend: e.leads_to_send,
        leadsSentBefore: e.leads_sent,
        remaining: e.leads_to_send - e.leads_sent,
        timezone: e.workspace_timezone,
      }));

      return new Response(JSON.stringify({
        success: true,
        dryRun: true,
        message: `Would process ${entries.length} queue entries`,
        entries: dryRunResults,
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ============================================
    // GET PROVIDER CREDENTIALS
    // ============================================
    const unipileDsn = Deno.env.get('UNIPILE_DSN');
    const unipileApiKey = Deno.env.get('UNIPILE_API_KEY');

    if (!unipileDsn || !unipileApiKey) {
      console.error('Messaging provider not configured');
      // Release claimed entries
      for (const entry of entries) {
        await supabase
          .from('campaign_queue')
          .update({ status: 'queued' })
          .eq('id', entry.queue_id);
      }
      return new Response(JSON.stringify({ error: 'Messaging provider not configured' }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    // ============================================
    // PROCESS EACH QUEUE ENTRY
    // ============================================
    const processResults: ProcessResult[] = [];

    for (const entry of entries) {
      const logPrefix = `[Queue ${entry.queue_id}]`;
      console.log(`${logPrefix} Processing campaign=${entry.campaign_id}, scheduled=${entry.scheduled_date}, toSend=${entry.leads_to_send}, sent=${entry.leads_sent}`);

      const remainingForQueue = entry.leads_to_send - entry.leads_sent;
      if (remainingForQueue <= 0) {
        console.log(`${logPrefix} Already fully sent, marking completed`);
        await supabase
          .from('campaign_queue')
          .update({ status: 'completed', processed_at: new Date().toISOString() })
          .eq('id', entry.queue_id);
        processResults.push({
          queueId: entry.queue_id,
          campaignId: entry.campaign_id,
          workspaceId: entry.workspace_id,
          scheduledDate: entry.scheduled_date,
          leadsToSend: entry.leads_to_send,
          leadsSentBefore: entry.leads_sent,
          sentNow: 0,
          failedNow: 0,
          remaining: 0,
          finalStatus: 'completed',
        });
        continue;
      }

      // Get campaign
      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .select('*')
        .eq('id', entry.campaign_id)
        .single();

      if (campaignError || !campaign) {
        console.error(`${logPrefix} Campaign not found:`, campaignError);
        await supabase
          .from('campaign_queue')
          .update({ status: 'completed', processed_at: new Date().toISOString() })
          .eq('id', entry.queue_id);
        continue;
      }

      // Get workspace settings
      const { data: workspaceSettings } = await supabase
        .from('workspace_settings')
        .select('daily_message_limit, message_interval_seconds, max_retries, linkedin_daily_message_limit, linkedin_daily_invite_limit, linkedin_message_interval_seconds')
        .eq('workspace_id', campaign.workspace_id)
        .maybeSingle();

      const settings: WorkspaceSettings = { ...DEFAULT_SETTINGS, ...workspaceSettings };

      const isLinkedIn = campaign.type === 'linkedin';
      const isWhatsApp = campaign.type === 'whatsapp';
      const linkedinAction = campaign.linkedin_action || 'dm'; // dm | inmail | invite
      const isLinkedInInvite = isLinkedIn && linkedinAction === 'invite';
      
      const dailyLimit = isLinkedIn 
        ? (isLinkedInInvite ? settings.linkedin_daily_invite_limit : settings.linkedin_daily_message_limit)
        : settings.daily_message_limit;
      const baseIntervalSeconds = isLinkedIn ? settings.linkedin_message_interval_seconds : settings.message_interval_seconds;
      const usageAction: UsageAction = isLinkedIn 
        ? (isLinkedInInvite ? 'linkedin_invite' : 'linkedin_message')
        : 'whatsapp_message';

      // Get account (include linkedin_feature for InMail api param)
      let unipileAccountId: string | null = null;
      let linkedinFeature: string = 'classic';
      
      if (campaign.type === 'whatsapp' || campaign.type === 'linkedin') {
        const { data: account } = await supabase
          .from('accounts')
          .select('account_id, status, linkedin_feature')
          .eq('id', campaign.account_id)
          .single();

        if (!account || account.status !== 'connected') {
          console.error(`${logPrefix} Account not connected`);
          await supabase
            .from('campaign_queue')
            .update({ status: 'completed', processed_at: new Date().toISOString() })
            .eq('id', entry.queue_id);
          continue;
        }
        unipileAccountId = account.account_id;
        linkedinFeature = account.linkedin_feature || 'classic';
      }

      // Check daily usage
      const todayDate = getTodayDateInTimezone(entry.workspace_timezone);
      let currentUsage = 0;

      if (unipileAccountId) {
        const { data: usageData } = await supabase.rpc('get_daily_usage', {
          p_workspace_id: campaign.workspace_id,
          p_account_id: unipileAccountId,
          p_action: usageAction,
          p_usage_date: todayDate,
        });
        currentUsage = usageData || 0;
      }

      const remainingCapacity = Math.max(0, dailyLimit - currentUsage);
      console.log(`${logPrefix} Usage: ${currentUsage}/${dailyLimit}, capacity=${remainingCapacity}, queueRemaining=${remainingForQueue}`);

      if (remainingCapacity === 0) {
        console.log(`${logPrefix} No capacity today, keeping in queue`);
        await supabase
          .from('campaign_queue')
          .update({ status: 'queued' })
          .eq('id', entry.queue_id);
        continue;
      }

      // Get pending leads (idempotent: only leads not yet sent)
      const leadsToFetch = Math.min(remainingForQueue, remainingCapacity);
      const { data: campaignLeads, error: leadsError } = await supabase
        .from('campaign_leads')
        .select(`
          id,
          lead_id,
          status,
          retry_count,
          lead:leads (
            id, full_name, first_name, last_name, email, mobile_number, phone,
            linkedin_url, company, job_title, city, state, country, industry
          )
        `)
        .eq('campaign_id', campaign.id)
        .or(`status.eq.pending,and(status.eq.failed,retry_count.lt.${settings.max_retries})`)
        .limit(leadsToFetch);

      if (leadsError || !campaignLeads || campaignLeads.length === 0) {
        console.log(`${logPrefix} No pending leads, marking completed`);
        await supabase
          .from('campaign_queue')
          .update({ status: 'completed', leads_sent: entry.leads_to_send, processed_at: new Date().toISOString() })
          .eq('id', entry.queue_id);
        processResults.push({
          queueId: entry.queue_id,
          campaignId: entry.campaign_id,
          workspaceId: entry.workspace_id,
          scheduledDate: entry.scheduled_date,
          leadsToSend: entry.leads_to_send,
          leadsSentBefore: entry.leads_sent,
          sentNow: 0,
          failedNow: 0,
          remaining: 0,
          finalStatus: 'completed',
        });
        continue;
      }

      // Update campaign status to sending
      await supabase
        .from('campaigns')
        .update({ status: 'sending' })
        .eq('id', campaign.id);

      let sentCount = 0;
      let failedCount = 0;

      // ============================================
      // SEND MESSAGES
      // ============================================
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
            formData.append('account_id', unipileAccountId!);
            formData.append('text', personalizedMessage);
            formData.append('attendees_ids', `${digits}@s.whatsapp.net`);

            const response = await fetch(`https://${unipileDsn}/api/v1/chats`, {
              method: 'POST',
              headers: { 'X-API-KEY': unipileApiKey, 'Accept': 'application/json' },
              body: formData,
            });

            if (response.ok) {
              sendSuccess = true;
              const responseData = await response.json().catch(() => ({}));
              providerMessageId = responseData.message_id || responseData.id || null;
            } else {
              sendError = await response.text().catch(() => `HTTP ${response.status}`);
            }
          } else if (campaign.type === 'linkedin') {
            const linkedinUrl = lead.linkedin_url;
            if (!linkedinUrl) throw new Error('No LinkedIn URL');

            const publicIdentifier = extractLinkedInPublicIdentifier(linkedinUrl);
            if (!publicIdentifier) throw new Error(`Invalid LinkedIn URL: ${linkedinUrl}`);

            const providerId = await resolveLinkedInProviderId(unipileDsn, unipileApiKey, unipileAccountId!, publicIdentifier);
            if (!providerId) throw new Error(`Could not resolve LinkedIn: ${publicIdentifier}`);

            // Map feature to API value
            const apiValue = linkedinFeature.toLowerCase().replace(/\s+/g, '_');

            if (linkedinAction === 'invite') {
              // LINKEDIN INVITE - Uses JSON body, NOT FormData
              
              // Validate providerId before sending
              if (!providerId) {
                throw new Error('Could not resolve provider_id for LinkedIn invite');
              }

              // Build JSON body
              const inviteBody: Record<string, string> = {
                account_id: unipileAccountId!,
                provider_id: providerId,
              };
              
              if (personalizedMessage && personalizedMessage.trim().length > 0) {
                inviteBody.message = personalizedMessage.slice(0, 300);
              }

              const inviteUrl = `https://${unipileDsn}/api/v1/users/invite`;
              console.log(`[INVITE] account_id=${unipileAccountId}, provider_id=${providerId}, publicIdentifier=${publicIdentifier}`);
              console.log(`[INVITE] Endpoint: ${inviteUrl}, Body: ${JSON.stringify(inviteBody)}`);

              const response = await fetch(inviteUrl, {
                method: 'POST',
                headers: {
                  'X-API-KEY': unipileApiKey,
                  'Accept': 'application/json',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(inviteBody),
              });

              const responseText = await response.text().catch(() => '');
              console.log(`[INVITE] Response: HTTP ${response.status} - ${responseText}`);
              
              if (response.ok) {
                sendSuccess = true;
                try {
                  const responseData = JSON.parse(responseText);
                  providerMessageId = responseData.invitation_id || responseData.id || null;
                } catch { /* ignore */ }
                console.log(`[INVITE] Success: ${publicIdentifier}, invitationId: ${providerMessageId || 'unknown'}`);
              } else {
                sendError = `LinkedIn invite failed (HTTP ${response.status}): ${responseText}`;
                console.error(`[INVITE] Failed: ${publicIdentifier} - ${sendError}`);
              }
            } else if (linkedinAction === 'inmail') {
              // LINKEDIN INMAIL
              const formData = new FormData();
              formData.append('account_id', unipileAccountId!);
              formData.append('text', personalizedMessage);
              formData.append('attendees_ids', providerId);
              formData.append('linkedin[inmail]', 'true');
              formData.append('linkedin[api]', apiValue);

              const response = await fetch(`https://${unipileDsn}/api/v1/chats`, {
                method: 'POST',
                headers: { 'X-API-KEY': unipileApiKey, 'Accept': 'application/json' },
                body: formData,
              });

              const responseText = await response.text().catch(() => '');
              if (response.ok) {
                sendSuccess = true;
                try {
                  const responseData = JSON.parse(responseText);
                  providerMessageId = responseData.message_id || responseData.id || null;
                } catch { /* ignore */ }
              } else {
                sendError = `HTTP ${response.status}: ${responseText}`;
              }
            } else {
              // LINKEDIN DM
              const formData = new FormData();
              formData.append('account_id', unipileAccountId!);
              formData.append('text', personalizedMessage);
              formData.append('attendees_ids', providerId);
              formData.append('linkedin[api]', apiValue);

              const response = await fetch(`https://${unipileDsn}/api/v1/chats`, {
                method: 'POST',
                headers: { 'X-API-KEY': unipileApiKey, 'Accept': 'application/json' },
                body: formData,
              });

              const responseText = await response.text().catch(() => '');
              if (response.ok) {
                sendSuccess = true;
                try {
                  const responseData = JSON.parse(responseText);
                  providerMessageId = responseData.message_id || responseData.id || null;
                } catch { /* ignore */ }
              } else {
                const lowerError = responseText.toLowerCase();
                if (lowerError.includes('not connected') || lowerError.includes('connection') || lowerError.includes('relationship')) {
                  sendError = `Não é conexão. Use Convite ou InMail. (HTTP ${response.status})`;
                } else {
                  sendError = `HTTP ${response.status}: ${responseText}`;
                }
              }
            }
          }

          if (sendSuccess) {
            await supabase
              .from('campaign_leads')
              .update({
                status: 'sent',
                sent_at: new Date().toISOString(),
                error: null,
                provider_message_id: providerMessageId,
              })
              .eq('id', cl.id);
            sentCount++;

            // Increment usage
            if (unipileAccountId) {
              await supabase.rpc('increment_daily_usage', {
                p_workspace_id: campaign.workspace_id,
                p_account_id: unipileAccountId,
                p_action: usageAction,
                p_usage_date: todayDate,
                p_increment: 1,
              });
            }
          } else {
            const newRetryCount = cl.retry_count + 1;
            const willRetry = newRetryCount < settings.max_retries;
            await supabase
              .from('campaign_leads')
              .update({
                status: willRetry ? 'pending' : 'failed',
                error: sendError,
                retry_count: newRetryCount,
              })
              .eq('id', cl.id);
            failedCount++;
            console.log(`${logPrefix} Lead ${cl.lead_id} failed (attempt ${newRetryCount}/${settings.max_retries})`);
          }

          // Delay between messages
          if (i < campaignLeads.length - 1) {
            const delaySeconds = applyJitter(baseIntervalSeconds, 10);
            await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
          }
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          const newRetryCount = cl.retry_count + 1;
          const willRetry = newRetryCount < settings.max_retries;
          await supabase
            .from('campaign_leads')
            .update({
              status: willRetry ? 'pending' : 'failed',
              error: errorMessage,
              retry_count: newRetryCount,
            })
            .eq('id', cl.id);
          failedCount++;
          console.error(`${logPrefix} Lead ${cl.lead_id} exception:`, errorMessage);
        }
      }

      // Update queue entry
      const newLeadsSent = entry.leads_sent + sentCount;
      const queueCompleted = newLeadsSent >= entry.leads_to_send;

      await supabase
        .from('campaign_queue')
        .update({
          status: queueCompleted ? 'completed' : 'queued',
          leads_sent: newLeadsSent,
          processed_at: queueCompleted ? new Date().toISOString() : null,
        })
        .eq('id', entry.queue_id);

      // NOTE: No longer updating campaigns.sent_count/failed_count incrementally
      // The view campaigns_with_stats calculates counts from campaign_leads current state

      // Finalize campaign status using source of truth logic
      const finalCampaignStatus = await finalizeCampaignStatus(supabase, campaign.id);

      console.log(`${logPrefix} Done: sent=${sentCount}, failed=${failedCount}, campaign=${finalCampaignStatus}`);

      processResults.push({
        queueId: entry.queue_id,
        campaignId: entry.campaign_id,
        workspaceId: entry.workspace_id,
        scheduledDate: entry.scheduled_date,
        leadsToSend: entry.leads_to_send,
        leadsSentBefore: entry.leads_sent,
        sentNow: sentCount,
        failedNow: failedCount,
        remaining: entry.leads_to_send - newLeadsSent,
        finalStatus: finalCampaignStatus,
      });
    }

    return new Response(JSON.stringify({
      success: true,
      processed: processResults,
      totalClaimed: entries.length,
      dryRun: false,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('[process-campaign-queue] Error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
