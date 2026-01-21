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

// Apply jitter to interval (±20% randomization)
function applyJitter(baseSeconds: number, minSeconds: number = 10): number {
  const jitterFactor = 0.8 + Math.random() * 0.4; // 0.8 to 1.2
  const jitteredValue = Math.round(baseSeconds * jitterFactor);
  return Math.max(jitteredValue, minSeconds);
}

// Get today's date in YYYY-MM-DD format
function getTodayDate(): string {
  return new Date().toISOString().split('T')[0];
}

// Get tomorrow's date string in YYYY-MM-DD format
function getTomorrowDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
}

// Get next day at 09:00 in specified timezone (fallback to UTC)
function getNextDayAt9AM(timezone: string = 'UTC'): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  try {
    // Create a date string for tomorrow at 09:00 in the target timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(tomorrow);
    const year = parts.find(p => p.type === 'year')?.value;
    const month = parts.find(p => p.type === 'month')?.value;
    const day = parts.find(p => p.type === 'day')?.value;
    
    // Return ISO string with 09:00 in the target timezone
    return `${year}-${month}-${day}T09:00:00`;
  } catch {
    // Fallback to UTC if timezone is invalid
    console.warn(`Invalid timezone: ${timezone}, falling back to UTC`);
  }
  
  // Default: 09:00 UTC
  tomorrow.setUTCHours(9, 0, 0, 0);
  return tomorrow.toISOString();
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

// Action types for usage tracking
type UsageAction = 'linkedin_message' | 'linkedin_invite' | 'whatsapp_message';

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

    // Service client for RPC calls (bypasses RLS)
    const serviceClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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
    // GET WORKSPACE TIMEZONE
    // ============================================
    const { data: workspace } = await supabase
      .from('workspaces')
      .select('timezone')
      .eq('id', campaign.workspace_id)
      .single();
    
    const workspaceTimezone = workspace?.timezone || 'UTC';
    console.log(`Workspace timezone: ${workspaceTimezone}`);

    // ============================================
    // GET WORKSPACE SETTINGS (including LinkedIn)
    // ============================================
    const { data: workspaceSettings } = await supabase
      .from('workspace_settings')
      .select('daily_message_limit, message_interval_seconds, max_retries, linkedin_daily_message_limit, linkedin_daily_invite_limit, linkedin_message_interval_seconds')
      .eq('workspace_id', campaign.workspace_id)
      .maybeSingle();

    const settings: WorkspaceSettings = {
      ...DEFAULT_SETTINGS,
      ...workspaceSettings,
    };

    // ============================================
    // SELECT CHANNEL-SPECIFIC SETTINGS
    // ============================================
    const isLinkedIn = campaign.type === 'linkedin';
    const isWhatsApp = campaign.type === 'whatsapp';
    const linkedinAction = campaign.linkedin_action || 'dm'; // dm | inmail | invite
    const isLinkedInInvite = isLinkedIn && linkedinAction === 'invite';
    
    // Use invite limit for invite action, message limit for dm/inmail
    const dailyLimit = isLinkedIn 
      ? (isLinkedInInvite ? settings.linkedin_daily_invite_limit : settings.linkedin_daily_message_limit) 
      : settings.daily_message_limit;
    const baseIntervalSeconds = isLinkedIn ? settings.linkedin_message_interval_seconds : settings.message_interval_seconds;
    const minIntervalSeconds = 10; // Both have 10s minimum

    // Determine usage action type
    const usageAction: UsageAction = isLinkedIn 
      ? (isLinkedInInvite ? 'linkedin_invite' : 'linkedin_message') 
      : isWhatsApp ? 'whatsapp_message' : 'whatsapp_message';

    console.log(`Using ${isLinkedIn ? `LinkedIn (${linkedinAction})` : 'WhatsApp'} settings: ${dailyLimit}/day, ${baseIntervalSeconds}s base interval (with ±20% jitter)`);

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
    // Variable naming convention:
    // - internalAccountUuid: Internal UUID from accounts.id (for DB references)
    // - unipileAccountId: Unipile's account ID from accounts.account_id (for API calls & usage tracking)
    let internalAccountUuid: string | null = null;
    let unipileAccountId: string | null = null;

    if (campaign.type === 'whatsapp' || campaign.type === 'linkedin') {
      if (!campaign.account_id) {
        return new Response(JSON.stringify({ error: 'Account is required for WhatsApp/LinkedIn campaigns' }), { status: 400, headers: corsHeaders });
      }

      // Verify account belongs to workspace (campaign.account_id stores the internal UUID)
      // Include linkedin_feature for InMail API parameter
      const { data: account, error: accountError } = await supabase
        .from('accounts')
        .select('id, account_id, status, linkedin_feature')
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

      internalAccountUuid = account.id; // Internal UUID (for DB references)
      unipileAccountId = account.account_id; // Unipile account ID (for API calls & usage tracking)
      
      // Store linkedin_feature for InMail api parameter
      if (isLinkedIn) {
        (campaign as any)._linkedinFeature = account.linkedin_feature || 'classic';
      }
    }

    // ============================================
    // CHECK CURRENT DAILY USAGE
    // ============================================
    const todayDate = getTodayDate();
    let currentUsage = 0;

    if (unipileAccountId) {
      const { data: usageData, error: usageError } = await serviceClient
        .rpc('get_daily_usage', {
          p_workspace_id: campaign.workspace_id,
          p_account_id: unipileAccountId,
          p_action: usageAction,
          p_usage_date: todayDate,
        });

      if (usageError) {
        console.error('Error fetching daily usage:', usageError);
      } else {
        currentUsage = usageData || 0;
      }
      
      console.log(`Current daily usage for ${usageAction}: ${currentUsage}/${dailyLimit}`);
    }

    // Calculate remaining capacity for today
    const remainingCapacity = Math.max(0, dailyLimit - currentUsage);

    // ============================================
    // GET PENDING LEADS FOR THIS CAMPAIGN
    // ============================================
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
      .eq('campaign_id', campaignId)
      .or(`status.eq.pending,and(status.eq.failed,retry_count.lt.${settings.max_retries})`);

    if (leadsError) {
      console.error('Error fetching campaign leads:', leadsError);
      return new Response(JSON.stringify({ error: 'Failed to fetch campaign leads' }), { status: 500, headers: corsHeaders });
    }

    if (!campaignLeads || campaignLeads.length === 0) {
      return new Response(JSON.stringify({ error: 'No leads to send' }), { status: 400, headers: corsHeaders });
    }

    const totalLeads = campaignLeads.length;
    const allPendingIds = (campaignLeads as unknown as CampaignLead[]).map(cl => cl.id);
    
    // ============================================
    // CALCULATE LEADS TO SEND TODAY
    // ============================================
    // FIXED: leadsToSendNow = min(totalLeads, remainingCapacity)
    // remainingCapacity = dailyLimit - currentUsage (what's left for today)
    const leadsToSendNow = Math.min(totalLeads, remainingCapacity);
    const remainingAfterToday = totalLeads - leadsToSendNow;
    
    console.log(`Campaign ${campaignId}: ${totalLeads} leads total`);
    console.log(`  currentUsage: ${currentUsage}, dailyLimit: ${dailyLimit}, remainingCapacity: ${remainingCapacity}`);
    console.log(`  leadsToSendNow: ${leadsToSendNow}, remainingAfterToday: ${remainingAfterToday}`);

    // ============================================
    // HELPER: UPSERT QUEUE ENTRY (idempotent)
    // ============================================
    async function upsertQueueEntry(scheduledDateStr: string, leadsCount: number) {
      // Use ON CONFLICT with unique index (campaign_id, scheduled_date)
      const { error } = await supabase
        .from('campaign_queue')
        .upsert({
          campaign_id: campaignId,
          workspace_id: campaign.workspace_id,
          scheduled_date: scheduledDateStr,
          leads_to_send: leadsCount,
          leads_sent: 0,
          status: 'queued',
        }, {
          onConflict: 'campaign_id,scheduled_date',
          ignoreDuplicates: false,
        });
      
      if (error) {
        console.error(`Error upserting queue entry for ${scheduledDateStr}:`, error);
      } else {
        console.log(`Queue entry upserted: ${scheduledDateStr} -> ${leadsCount} leads`);
      }
    }

    // ============================================
    // CHECK DAILY LIMIT - DEFER IF NO CAPACITY
    // ============================================
    if (leadsToSendNow === 0) {
      console.log(`No capacity remaining for ${usageAction} today (${currentUsage}/${dailyLimit}). Deferring campaign.`);
      
      const tomorrowDateStr = getTomorrowDate();
      
      // All leads remain pending - campaign_queue handles scheduling
      // DO NOT mark as deferred - keep as pending for queue processor
      
      // Upsert queue entry for tomorrow (idempotent)
      await upsertQueueEntry(tomorrowDateStr, totalLeads);

      // Update campaign status to queued
      await supabase
        .from('campaigns')
        .update({ status: 'queued' })
        .eq('id', campaignId);

      return new Response(JSON.stringify({
        success: true,
        campaignId,
        status: 'queued',
        reason: 'DAILY_LIMIT_REACHED',
        nextRunAt: getNextDayAt9AM(workspaceTimezone),
        currentUsage,
        dailyLimit,
        remainingCapacity: 0,
        scheduledDate: tomorrowDateStr,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ============================================
    // CREATE QUEUE FOR REMAINING LEADS (if any)
    // ============================================
    // Get leads we'll process today (first N by order)
    const leadsToProcess = (campaignLeads as unknown as CampaignLead[]).slice(0, leadsToSendNow);
    const idsToSend = new Set(leadsToProcess.map(cl => cl.id));
    
    // IDs that won't be sent today - these remain pending for queue
    const idsToDefer = allPendingIds.filter(id => !idsToSend.has(id));
    
    if (remainingAfterToday > 0) {
      console.log(`${remainingAfterToday} leads won't fit today. Creating queue entries...`);
      console.log(`  idsToSend: ${idsToSend.size}, idsToDefer: ${idsToDefer.length}`);
      
      // Calculate how many additional days needed using FULL dailyLimit (not remainingCapacity)
      const additionalDays = Math.ceil(remainingAfterToday / dailyLimit);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Create/update queue entries for subsequent days (idempotent via upsert)
      let leadsRemaining = remainingAfterToday;
      
      for (let day = 1; day <= additionalDays; day++) {
        const scheduledDate = new Date(today);
        scheduledDate.setDate(scheduledDate.getDate() + day);
        const scheduledDateStr = scheduledDate.toISOString().split('T')[0];
        
        // Each day gets up to dailyLimit (full capacity)
        const leadsForDay = Math.min(leadsRemaining, dailyLimit);
        leadsRemaining -= leadsForDay;

        if (leadsForDay > 0) {
          await upsertQueueEntry(scheduledDateStr, leadsForDay);
        }
      }

      // Update campaign status to 'queued' (will be partially completed)
      await supabase
        .from('campaigns')
        .update({ status: 'queued' })
        .eq('id', campaignId);
      
      // NOTE: We do NOT mark deferred leads here - they remain 'pending'
      // The campaign_queue processor will handle them on their scheduled date
    }

    console.log(`Starting campaign ${campaignId}: sending ${leadsToProcess.length} of ${totalLeads} leads today`);

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
    let deferredCount = 0;
    const results: { leadId: string; success: boolean; error?: string; retryCount?: number; willRetry?: boolean; deferred?: boolean }[] = [];

    for (let i = 0; i < leadsToProcess.length; i++) {
      const cl = leadsToProcess[i];
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
        let providerMessageId: string | null = null;

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
          formData.append('account_id', unipileAccountId!);
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
            // Store provider message ID for tracking
            if (responseData.message_id || responseData.id) {
              providerMessageId = responseData.message_id || responseData.id;
            }
            console.log(`WhatsApp message sent to ${phoneNumber}, messageId: ${providerMessageId || 'unknown'}`);
          } else {
            const errorText = await response.text().catch(() => '');
            sendError = errorText || `HTTP ${response.status}`;
            console.error(`Failed to send WhatsApp to ${phoneNumber}:`, sendError);
          }
        } else if (campaign.type === 'linkedin') {
          // LinkedIn requires provider_id - resolve from linkedin_url first
          const linkedinUrl = lead.linkedin_url;
          
          if (!linkedinUrl) {
            throw new Error('No LinkedIn URL available');
          }

          // Extract public identifier from LinkedIn URL
          const publicIdentifier = extractLinkedInPublicIdentifier(linkedinUrl);
          if (!publicIdentifier) {
            throw new Error(`Invalid LinkedIn URL format: ${linkedinUrl}`);
          }

          // Resolve to provider_id via Unipile user lookup
          const providerId = await resolveLinkedInProviderId(unipileDsn, unipileApiKey, unipileAccountId!, publicIdentifier);
          
          if (!providerId) {
            throw new Error(`Could not resolve LinkedIn profile: ${publicIdentifier}`);
          }

          // Get linkedin_feature for API parameter (from account fetch earlier)
          const linkedinFeature = (campaign as any)._linkedinFeature || 'classic';
          // Map feature to API value: Classic, Sales Navigator, Recruiter -> classic, sales_navigator, recruiter
          const apiValue = linkedinFeature.toLowerCase().replace(/\s+/g, '_').replace('sales_navigator', 'sales_navigator');

          if (linkedinAction === 'invite') {
            // ============================================
            // LINKEDIN INVITE (Connection Request)
            // ============================================
            const formData = new FormData();
            formData.append('provider_id', providerId);
            formData.append('account_id', unipileAccountId!);
            // Message is optional for invites (note field)
            if (personalizedMessage && personalizedMessage.trim().length > 0) {
              // Truncate to 300 chars max
              const note = personalizedMessage.slice(0, 300);
              formData.append('message', note);
            }

            const inviteUrl = `https://${unipileDsn}/api/v1/users/invite`;
            console.log(`LinkedIn invite to ${publicIdentifier} (providerId: ${providerId}), endpoint: ${inviteUrl}`);

            const response = await fetch(inviteUrl, {
              method: 'POST',
              headers: {
                'X-API-KEY': unipileApiKey,
                'Accept': 'application/json',
              },
              body: formData,
            });

            const responseText = await response.text().catch(() => '');
            console.log(`LinkedIn invite response: HTTP ${response.status} - ${responseText}`);

            if (response.ok) {
              sendSuccess = true;
              try {
                const responseData = JSON.parse(responseText);
                providerMessageId = responseData.invitation_id || responseData.id || null;
              } catch {
                // Response might not be JSON
              }
              console.log(`LinkedIn invite sent to ${publicIdentifier}, invitationId: ${providerMessageId || 'unknown'}`);
            } else {
              sendError = `HTTP ${response.status}: ${responseText}`;
              console.error(`Failed LinkedIn invite to ${publicIdentifier}:`, sendError);
            }
          } else if (linkedinAction === 'inmail') {
            // ============================================
            // LINKEDIN INMAIL (Premium message)
            // ============================================
            const formData = new FormData();
            formData.append('account_id', unipileAccountId!);
            formData.append('text', personalizedMessage);
            formData.append('attendees_ids', providerId);
            formData.append('linkedin[inmail]', 'true');
            formData.append('linkedin[api]', apiValue);

            const chatUrl = `https://${unipileDsn}/api/v1/chats`;
            console.log(`LinkedIn InMail to ${publicIdentifier}, api: ${apiValue}, endpoint: ${chatUrl}`);

            const response = await fetch(chatUrl, {
              method: 'POST',
              headers: {
                'X-API-KEY': unipileApiKey,
                'Accept': 'application/json',
              },
              body: formData,
            });

            const responseText = await response.text().catch(() => '');
            console.log(`LinkedIn InMail response: HTTP ${response.status} - ${responseText}`);

            if (response.ok) {
              sendSuccess = true;
              try {
                const responseData = JSON.parse(responseText);
                providerMessageId = responseData.message_id || responseData.id || null;
              } catch {
                // Response might not be JSON
              }
              console.log(`LinkedIn InMail sent to ${publicIdentifier}, messageId: ${providerMessageId || 'unknown'}`);
            } else {
              sendError = `HTTP ${response.status}: ${responseText}`;
              console.error(`Failed LinkedIn InMail to ${publicIdentifier}:`, sendError);
            }
          } else {
            // ============================================
            // LINKEDIN DM (Direct Message - requires connection)
            // ============================================
            const formData = new FormData();
            formData.append('account_id', unipileAccountId!);
            formData.append('text', personalizedMessage);
            formData.append('attendees_ids', providerId);
            formData.append('linkedin[api]', apiValue);

            const chatUrl = `https://${unipileDsn}/api/v1/chats`;
            console.log(`LinkedIn DM to ${publicIdentifier}, api: ${apiValue}, endpoint: ${chatUrl}`);

            const response = await fetch(chatUrl, {
              method: 'POST',
              headers: {
                'X-API-KEY': unipileApiKey,
                'Accept': 'application/json',
              },
              body: formData,
            });

            const responseText = await response.text().catch(() => '');
            console.log(`LinkedIn DM response: HTTP ${response.status} - ${responseText}`);

            if (response.ok) {
              sendSuccess = true;
              try {
                const responseData = JSON.parse(responseText);
                providerMessageId = responseData.message_id || responseData.id || null;
              } catch {
                // Response might not be JSON
              }
              console.log(`LinkedIn DM sent to ${publicIdentifier}, messageId: ${providerMessageId || 'unknown'}`);
            } else {
              // Check if the error is related to not being connected
              const lowerError = responseText.toLowerCase();
              if (lowerError.includes('not connected') || lowerError.includes('connection') || lowerError.includes('relationship')) {
                sendError = `Não é conexão. Use Convite ou InMail. (HTTP ${response.status}: ${responseText})`;
              } else {
                sendError = `HTTP ${response.status}: ${responseText}`;
              }
              console.error(`Failed LinkedIn DM to ${publicIdentifier}:`, sendError);
            }
          }
        } else if (campaign.type === 'email') {
          // Email sending placeholder - not implemented
          throw new Error('Email campaigns not yet implemented');
        }

        if (sendSuccess) {
          sentCount++;
          results.push({ leadId: cl.lead_id, success: true });
          
          // Update campaign_lead status
          await supabase
            .from('campaign_leads')
            .update({ 
              status: 'sent', 
              sent_at: new Date().toISOString(),
              error: null,
              provider_message_id: providerMessageId,
            })
            .eq('id', cl.id);

          // INCREMENT DAILY USAGE (after successful send)
          if (unipileAccountId) {
            const { data: newUsage, error: incrementError } = await serviceClient
              .rpc('increment_daily_usage', {
                p_workspace_id: campaign.workspace_id,
                p_account_id: unipileAccountId,
                p_action: usageAction,
                p_usage_date: todayDate,
                p_increment: 1,
              });

            if (incrementError) {
              console.error(`Error incrementing usage for ${usageAction}:`, incrementError);
            } else {
              console.log(`Usage incremented for ${usageAction}: now ${newUsage}/${dailyLimit}`);
            }
          }

          // Update campaign sent_count incrementally
          await supabase
            .from('campaigns')
            .update({ sent_count: campaign.sent_count + sentCount })
            .eq('id', campaignId);
        } else {
          const newRetryCount = cl.retry_count + 1;
          const willRetry = newRetryCount < settings.max_retries;
          
          failedCount++;
          results.push({ 
            leadId: cl.lead_id, 
            success: false, 
            error: sendError,
            retryCount: newRetryCount,
            willRetry
          });
          
          // Update campaign_lead with failure
          await supabase
            .from('campaign_leads')
            .update({ 
              status: willRetry ? 'pending' : 'failed', 
              error: sendError,
              retry_count: newRetryCount,
            })
            .eq('id', cl.id);

          // Update campaign failed_count incrementally
          await supabase
            .from('campaigns')
            .update({ failed_count: campaign.failed_count + failedCount })
            .eq('id', campaignId);
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        const newRetryCount = cl.retry_count + 1;
        const willRetry = newRetryCount < settings.max_retries;
        
        failedCount++;
        results.push({ 
          leadId: cl.lead_id, 
          success: false, 
          error: errorMessage,
          retryCount: newRetryCount,
          willRetry
        });
        
        // Update campaign_lead with error
        await supabase
          .from('campaign_leads')
          .update({ 
            status: willRetry ? 'pending' : 'failed', 
            error: errorMessage,
            retry_count: newRetryCount,
          })
          .eq('id', cl.id);

        console.error(`Error sending to lead ${cl.lead_id}:`, errorMessage);
      }

      // Apply jitter delay between messages (except for last message)
      if (i < leadsToProcess.length - 1) {
        const delaySeconds = applyJitter(baseIntervalSeconds, minIntervalSeconds);
        console.log(`Waiting ${delaySeconds}s before next message...`);
        await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
      }
    }

    // ============================================
    // UPDATE FINAL CAMPAIGN STATUS
    // ============================================
    const { data: updatedCampaign } = await supabase
      .from('campaigns')
      .select('sent_count, failed_count, leads_count')
      .eq('id', campaignId)
      .single();

    // Check if there are queued entries (partial completion)
    const { data: queuedEntries } = await supabase
      .from('campaign_queue')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('status', 'queued')
      .limit(1);
    
    const hasQueuedEntries = queuedEntries && queuedEntries.length > 0;

    // Determine final status
    let finalStatus: string;
    if (hasQueuedEntries) {
      finalStatus = 'queued'; // More leads to send on future days
    } else if (failedCount > 0 && sentCount === 0) {
      finalStatus = 'failed';
    } else if (failedCount > 0 && sentCount > 0) {
      finalStatus = 'partial';
    } else if (updatedCampaign && updatedCampaign.sent_count >= updatedCampaign.leads_count) {
      finalStatus = 'completed';
    } else {
      finalStatus = sentCount > 0 ? 'running' : 'failed';
    }

    // Update final counts and status
    await supabase
      .from('campaigns')
      .update({ 
        status: finalStatus,
        sent_count: (updatedCampaign?.sent_count || 0),
        failed_count: (updatedCampaign?.failed_count || 0),
      })
      .eq('id', campaignId);

    console.log(`Campaign ${campaignId} finished: ${sentCount} sent, ${failedCount} failed, status: ${finalStatus}`);

    return new Response(JSON.stringify({
      success: true,
      campaignId,
      status: finalStatus,
      sentToday: sentCount,
      failed: failedCount,
      deferred: idsToDefer.length,
      results,
      hasQueuedEntries,
      currentUsage: currentUsage + sentCount,
      dailyLimit,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (error) {
    console.error('Error in send-campaign:', error);
    return new Response(JSON.stringify({ error: String(error) }), { status: 500, headers: corsHeaders });
  }
});

// ============================================
// HELPER: Extract LinkedIn public identifier from URL
// ============================================
function extractLinkedInPublicIdentifier(linkedinUrl: string): string | null {
  // Handle various LinkedIn URL formats:
  // https://www.linkedin.com/in/username
  // https://linkedin.com/in/username/
  // https://www.linkedin.com/in/username?param=value
  // /in/username
  
  try {
    const url = linkedinUrl.startsWith('http') ? new URL(linkedinUrl) : new URL(`https://linkedin.com${linkedinUrl.startsWith('/') ? '' : '/'}${linkedinUrl}`);
    const pathParts = url.pathname.split('/').filter(Boolean);
    
    // Find 'in' segment and get the next segment
    const inIndex = pathParts.findIndex(p => p.toLowerCase() === 'in');
    if (inIndex !== -1 && pathParts[inIndex + 1]) {
      return pathParts[inIndex + 1];
    }
    
    // Fallback: just return the last non-empty segment
    return pathParts[pathParts.length - 1] || null;
  } catch {
    // If URL parsing fails, try regex
    const match = linkedinUrl.match(/\/in\/([^\/\?]+)/);
    return match ? match[1] : null;
  }
}

// ============================================
// HELPER: Resolve LinkedIn public identifier to provider_id
// ============================================
async function resolveLinkedInProviderId(
  unipileDsn: string, 
  unipileApiKey: string, 
  accountId: string, 
  publicIdentifier: string
): Promise<string | null> {
  try {
    // Unipile endpoint: GET /api/v1/users/{public_identifier}
    const response = await fetch(`https://${unipileDsn}/api/v1/users/${encodeURIComponent(publicIdentifier)}?account_id=${accountId}`, {
      method: 'GET',
      headers: {
        'X-API-KEY': unipileApiKey,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => '');
      console.error(`LinkedIn user lookup failed for ${publicIdentifier}: HTTP ${response.status} - ${errorText}`);
      return null;
    }

    const data = await response.json();
    // The provider_id is typically in data.provider_id or data.id
    const providerId = data.provider_id || data.id;
    
    if (providerId) {
      console.log(`Resolved LinkedIn ${publicIdentifier} -> provider_id: ${providerId}`);
      return providerId;
    }
    
    console.error(`LinkedIn user lookup returned no provider_id for ${publicIdentifier}:`, data);
    return null;
  } catch (error) {
    console.error(`Error resolving LinkedIn provider_id for ${publicIdentifier}:`, error);
    return null;
  }
}
