import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // ============================================
    // AUTHENTICATE USER
    // ============================================
    const authHeader = req.headers.get('Authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
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
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { 
        status: 401, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // ============================================
    // PARSE REQUEST
    // ============================================
    const { 
      workspaceId, 
      accountId, // Internal account UUID 
      linkedinUrl, // Target's LinkedIn URL or profile ID
      note // Optional connection note (max 300 chars)
    } = await req.json();

    if (!workspaceId || !accountId || !linkedinUrl) {
      return new Response(JSON.stringify({ 
        error: 'workspaceId, accountId, and linkedinUrl are required' 
      }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Validate note length (LinkedIn max is 300 characters)
    if (note && note.length > 300) {
      return new Response(JSON.stringify({ 
        error: 'Connection note cannot exceed 300 characters' 
      }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    console.log(`Sending LinkedIn invite from workspace ${workspaceId} to ${linkedinUrl}`);

    // ============================================
    // VERIFY WORKSPACE MEMBERSHIP
    // ============================================
    const { data: memberCheck } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', claimsData.user.id)
      .single();

    if (!memberCheck) {
      return new Response(JSON.stringify({ error: 'Access denied to this workspace' }), { 
        status: 403, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // ============================================
    // VALIDATE ACCOUNT
    // ============================================
    const { data: account, error: accountError } = await supabase
      .from('accounts')
      .select('account_id, status, channel')
      .eq('id', accountId)
      .eq('workspace_id', workspaceId)
      .single();

    if (accountError || !account) {
      console.error('Account not found:', accountError);
      return new Response(JSON.stringify({ error: 'Account not found' }), { 
        status: 404, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (account.channel !== 'linkedin') {
      return new Response(JSON.stringify({ error: 'Account is not a LinkedIn account' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (account.status !== 'connected') {
      return new Response(JSON.stringify({ error: 'Account is not connected. Please reconnect.' }), { 
        status: 400, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // Unipile account ID (for API calls & usage tracking)
    const unipileAccountId = account.account_id;

    // ============================================
    // GET WORKSPACE SETTINGS FOR RATE LIMITING
    // ============================================
    const { data: workspaceSettings } = await supabase
      .from('workspace_settings')
      .select('linkedin_daily_invite_limit, linkedin_message_interval_seconds')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    const dailyInviteLimit = workspaceSettings?.linkedin_daily_invite_limit ?? 25;
    const baseIntervalSeconds = workspaceSettings?.linkedin_message_interval_seconds ?? 30;

    // ============================================
    // CHECK CURRENT DAILY USAGE
    // ============================================
    const todayDate = getTodayDate();
    const usageAction = 'linkedin_invite';

    const { data: usageData, error: usageError } = await serviceClient
      .rpc('get_daily_usage', {
        p_workspace_id: workspaceId,
        p_account_id: unipileAccountId,
        p_action: usageAction,
        p_usage_date: todayDate,
      });

    if (usageError) {
      console.error('Error fetching daily usage:', usageError);
    }

    const currentUsage = usageData || 0;
    const remainingCapacity = Math.max(0, dailyInviteLimit - currentUsage);

    console.log(`LinkedIn invite usage: ${currentUsage}/${dailyInviteLimit}, remaining: ${remainingCapacity}`);

    // ============================================
    // CHECK DAILY LIMIT
    // ============================================
    if (remainingCapacity === 0) {
      console.log(`Daily invite limit reached for account ${unipileAccountId}`);
      return new Response(JSON.stringify({
        success: false,
        error: 'Daily invite limit reached',
        status: 'deferred',
        reason: 'DAILY_LIMIT_REACHED',
        currentUsage,
        dailyLimit: dailyInviteLimit,
      }), { 
        status: 429, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // ============================================
    // GET PROVIDER CREDENTIALS
    // ============================================
    const unipileDsn = Deno.env.get('UNIPILE_DSN');
    const unipileApiKey = Deno.env.get('UNIPILE_API_KEY');

    if (!unipileDsn || !unipileApiKey) {
      console.error('Messaging provider not configured');
      return new Response(JSON.stringify({ error: 'Messaging provider not configured' }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    // ============================================
    // APPLY JITTER DELAY (for rate limiting)
    // ============================================
    // Only apply if this is part of a batch (could be extended with a skipDelay param)
    // For now, we'll apply a small jitter to avoid burst requests
    const delaySeconds = applyJitter(baseIntervalSeconds * 0.3, 2); // 30% of interval, min 2s
    console.log(`Applying ${delaySeconds}s jitter delay before invite`);
    await new Promise(resolve => setTimeout(resolve, delaySeconds * 1000));

    // ============================================
    // SEND LINKEDIN INVITE
    // ============================================
    // Unipile endpoint: POST /api/v1/users/invite
    const formData = new FormData();
    formData.append('account_id', unipileAccountId);
    formData.append('provider_id', linkedinUrl); // LinkedIn URL or provider ID
    
    if (note) {
      formData.append('message', note);
    }

    console.log(`Sending invite request to Unipile for account ${unipileAccountId}`);

    const response = await fetch(`https://${unipileDsn}/api/v1/users/invite`, {
      method: 'POST',
      headers: {
        'X-API-KEY': unipileApiKey,
        'Accept': 'application/json',
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      const errorMessage = errorData.message || `HTTP ${response.status}`;
      console.error('Failed to send LinkedIn invite:', errorMessage);
      return new Response(JSON.stringify({ 
        error: 'Failed to send connection request',
        details: errorMessage,
      }), { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const responseData = await response.json().catch(() => ({}));
    console.log('LinkedIn invite sent successfully:', JSON.stringify(responseData));

    // ============================================
    // INCREMENT DAILY USAGE (after successful send)
    // ============================================
    const { data: newUsage, error: incrementError } = await serviceClient
      .rpc('increment_daily_usage', {
        p_workspace_id: workspaceId,
        p_account_id: unipileAccountId,
        p_action: usageAction,
        p_usage_date: todayDate,
        p_increment: 1,
      });

    if (incrementError) {
      console.error(`Error incrementing usage for ${usageAction}:`, incrementError);
    } else {
      console.log(`Usage incremented for ${usageAction}: now ${newUsage}/${dailyInviteLimit}`);
    }

    // ============================================
    // RETURN SUCCESS
    // ============================================
    return new Response(JSON.stringify({
      success: true,
      invitationId: responseData.invitation_id || responseData.id,
      status: 'pending', // Invites are always pending until accepted
      message: 'Connection request sent successfully',
      usage: {
        action: usageAction,
        current: newUsage || currentUsage + 1,
        limit: dailyInviteLimit,
      },
    }), { 
      status: 200, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });

  } catch (err) {
    const error = err as Error;
    console.error('Error in send-linkedin-invite:', error);
    return new Response(JSON.stringify({ error: error.message }), { 
      status: 500, 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
});
