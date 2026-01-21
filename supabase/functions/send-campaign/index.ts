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

// Get next day at 09:00 in specified timezone (fallback to UTC)
function getNextDayAt9AM(timezone?: string): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  
  if (timezone) {
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
      // This is approximate - for precise scheduling, store the timezone and handle in CRON
      return `${year}-${month}-${day}T09:00:00`;
    } catch {
      // Fallback to UTC if timezone is invalid
      console.warn(`Invalid timezone: ${timezone}, falling back to UTC`);
    }
  }
  
  // Default: 09:00 UTC
  tomorrow.setUTCHours(9, 0, 0, 0);
  return tomorrow.toISOString();
}

// Get tomorrow's date string in YYYY-MM-DD format
function getTomorrowDate(): string {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  return tomorrow.toISOString().split('T')[0];
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
    const dailyLimit = isLinkedIn ? settings.linkedin_daily_message_limit : settings.daily_message_limit;
    const baseIntervalSeconds = isLinkedIn ? settings.linkedin_message_interval_seconds : settings.message_interval_seconds;
    const minIntervalSeconds = 10; // Both have 10s minimum

    // Determine usage action type
    const usageAction: UsageAction = isLinkedIn ? 'linkedin_message' : isWhatsApp ? 'whatsapp_message' : 'whatsapp_message';

    console.log(`Using ${isLinkedIn ? 'LinkedIn' : 'WhatsApp'} settings: ${dailyLimit} msgs/day, ${baseIntervalSeconds}s base interval (with ±20% jitter)`);

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
      const { data: account, error: accountError } = await supabase
        .from('accounts')
        .select('id, account_id, status')
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
    // CHECK DAILY LIMIT - DEFER IF NO CAPACITY
    // ============================================
    if (leadsToSendNow === 0) {
      console.log(`No capacity remaining for ${usageAction} today (${currentUsage}/${dailyLimit}). Deferring campaign.`);
      
      const tomorrowDateStr = getTomorrowDate();
      
      // Update all pending leads to DEFERRED status
      await supabase
        .from('campaign_leads')
        .update({ 
          status: 'deferred',
          error: 'DEFERRED_DAILY_LIMIT',
        })
        .eq('campaign_id', campaignId)
        .in('status', ['pending', 'deferred']);

      // Check if queue entry already exists for tomorrow
      const { data: existingQueue } = await supabase
        .from('campaign_queue')
        .select('id, leads_to_send')
        .eq('campaign_id', campaignId)
        .eq('scheduled_date', tomorrowDateStr)
        .maybeSingle();

      if (!existingQueue) {
        await supabase
          .from('campaign_queue')
          .insert({
            campaign_id: campaignId,
            workspace_id: campaign.workspace_id,
            scheduled_date: tomorrowDateStr,
            leads_to_send: totalLeads,
            leads_sent: 0,
            status: 'queued',
          });
        console.log(`Queue entry created for ${tomorrowDateStr}: ${totalLeads} leads`);
      } else {
        // Update existing entry with correct lead count
        await supabase
          .from('campaign_queue')
          .update({ leads_to_send: totalLeads })
          .eq('id', existingQueue.id);
        console.log(`Queue entry updated for ${tomorrowDateStr}: ${totalLeads} leads`);
      }

      // Update campaign status
      await supabase
        .from('campaigns')
        .update({ status: 'queued' })
        .eq('id', campaignId);

      return new Response(JSON.stringify({
        success: true,
        campaignId,
        status: 'deferred',
        reason: 'DAILY_LIMIT_REACHED',
        nextRunAt: getNextDayAt9AM(),
        currentUsage,
        dailyLimit,
        remainingCapacity: 0,
        scheduledDate: tomorrowDateStr,
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ============================================
    // CREATE QUEUE FOR REMAINING LEADS (if any)
    // ============================================
    if (remainingAfterToday > 0) {
      console.log(`${remainingAfterToday} leads won't fit today. Creating queue entries...`);
      
      // Calculate how many additional days needed using FULL dailyLimit (not remainingCapacity)
      const additionalDays = Math.ceil(remainingAfterToday / dailyLimit);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      // Create queue entries for subsequent days
      const queueEntries = [];
      let leadsRemaining = remainingAfterToday;
      
      for (let day = 1; day <= additionalDays; day++) {
        const scheduledDate = new Date(today);
        scheduledDate.setDate(scheduledDate.getDate() + day);
        const scheduledDateStr = scheduledDate.toISOString().split('T')[0];
        
        // Each day gets up to dailyLimit (full capacity)
        const leadsForDay = Math.min(leadsRemaining, dailyLimit);
        leadsRemaining -= leadsForDay;

        if (leadsForDay > 0) {
          queueEntries.push({
            campaign_id: campaignId,
            workspace_id: campaign.workspace_id,
            scheduled_date: scheduledDateStr,
            leads_to_send: leadsForDay,
            leads_sent: 0,
            status: 'queued',
          });
          console.log(`  Queue entry: ${scheduledDateStr} -> ${leadsForDay} leads`);
        }
      }

      if (queueEntries.length > 0) {
        const { error: queueError } = await supabase
          .from('campaign_queue')
          .insert(queueEntries);

        if (queueError) {
          console.error('Error creating queue entries:', queueError);
          // Don't fail - continue sending what we can today
        } else {
          console.log(`Queue created: ${queueEntries.length} entries for ${remainingAfterToday} leads`);
        }

        // Update campaign status to 'queued' (will be partially completed)
        await supabase
          .from('campaigns')
          .update({ status: 'queued' })
          .eq('id', campaignId);
      }
      
      // Mark remaining leads (those not being sent today) as deferred
      const leadsToProcess = (campaignLeads as unknown as CampaignLead[]).slice(0, leadsToSendNow);
      const leadIdsToSend = leadsToProcess.map(cl => cl.id);
      
      // Defer leads that won't be sent today
      await supabase
        .from('campaign_leads')
        .update({ 
          status: 'deferred',
          error: 'QUEUED_FOR_LATER',
        })
        .eq('campaign_id', campaignId)
        .eq('status', 'pending')
        .not('id', 'in', `(${leadIdsToSend.join(',')})`);
    }

    // Get the leads we'll actually process today
    const leadsToProcess = (campaignLeads as unknown as CampaignLead[]).slice(0, leadsToSendNow);

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
          // LinkedIn requires attendees_ids (profile ID from linkedin_url)
          const linkedinUrl = lead.linkedin_url;
          
          if (!linkedinUrl) {
            throw new Error('No LinkedIn URL available');
          }

          // Extract LinkedIn ID from URL or use URL directly
          // Note: Unipile may need the internal profile ID, which we might not have
          // For now, we'll try with the URL - may need adjustment based on Unipile's requirements
          
          const formData = new FormData();
          formData.append('account_id', unipileAccountId!);
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
            const responseData = await response.json().catch(() => ({}));
            if (responseData.message_id || responseData.id) {
              providerMessageId = responseData.message_id || responseData.id;
            }
            console.log(`LinkedIn message sent to ${linkedinUrl}, messageId: ${providerMessageId || 'unknown'}`);
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
          results.push({ leadId: cl.lead_id, success: true });

          // ============================================
          // INCREMENT DAILY USAGE (after successful send)
          // ============================================
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
          results.push({ 
            leadId: cl.lead_id, 
            success: false, 
            error: sendError,
            retryCount: newRetryCount,
            willRetry: !isFinalFailure,
          });
          console.log(`Lead ${cl.lead_id} failed (attempt ${newRetryCount}/${settings.max_retries})${isFinalFailure ? ' - no more retries' : ''}`);
        }

        // Apply jitter to interval (±20% randomization) for more natural sending pattern
        if (i < leadsToProcess.length - 1) {
          const delaySeconds = applyJitter(baseIntervalSeconds, minIntervalSeconds);
          console.log(`Waiting ${delaySeconds}s before next message (base: ${baseIntervalSeconds}s)`);
          await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error sending to lead ${cl.lead_id}:`, errorMessage);
        
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
        results.push({ 
          leadId: cl.lead_id, 
          success: false, 
          error: errorMessage,
          retryCount: newRetryCount,
          willRetry: !isFinalFailure,
        });
        console.log(`Lead ${cl.lead_id} exception (attempt ${newRetryCount}/${settings.max_retries})${isFinalFailure ? ' - no more retries' : ''}`);
      }
    }

    // ============================================
    // UPDATE QUEUE ENTRY IF EXISTS
    // ============================================
    const today = new Date().toISOString().split('T')[0];
    await supabase
      .from('campaign_queue')
      .update({ 
        leads_sent: sentCount, 
        status: 'completed',
        processed_at: new Date().toISOString()
      })
      .eq('campaign_id', campaignId)
      .eq('scheduled_date', today);

    // ============================================
    // UPDATE CAMPAIGN FINAL STATUS
    // ============================================
    // Check if there are more queued items
    const { data: pendingQueue } = await supabase
      .from('campaign_queue')
      .select('id')
      .eq('campaign_id', campaignId)
      .eq('status', 'queued');

    const hasMoreInQueue = pendingQueue && pendingQueue.length > 0;

    let finalStatus: string;
    if (hasMoreInQueue) {
      finalStatus = 'queued';
    } else if (failedCount === leadsToProcess.length) {
      finalStatus = 'failed';
    } else if (sentCount === totalLeads) {
      finalStatus = 'completed';
    } else {
      finalStatus = totalLeads > dailyLimit ? 'queued' : 'partial';
    }

    await supabase
      .from('campaigns')
      .update({
        status: finalStatus,
        sent_count: campaign.sent_count + sentCount,
        failed_count: campaign.failed_count + failedCount,
      })
      .eq('id', campaignId);

    console.log(`Campaign ${campaignId} batch completed: ${sentCount} sent, ${failedCount} failed. Status: ${finalStatus}`);

    return new Response(JSON.stringify({
      success: true,
      campaignId,
      sentCount,
      failedCount,
      totalLeads,
      status: finalStatus,
      hasMoreInQueue,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in send-campaign:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
