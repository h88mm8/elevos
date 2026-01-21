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

    // ============================================
    // GET WORKSPACE SETTINGS FOR RATE LIMITING
    // ============================================
    const { data: workspaceSettings } = await supabase
      .from('workspace_settings')
      .select('linkedin_daily_invite_limit')
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    const dailyInviteLimit = workspaceSettings?.linkedin_daily_invite_limit ?? 25;

    // TODO: Implement daily invite counting
    // For now, we just log the limit but don't enforce it
    // In production, you'd check against a counter table
    console.log(`Daily invite limit: ${dailyInviteLimit}`);

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
    // SEND LINKEDIN INVITE
    // ============================================
    // Unipile endpoint: POST /api/v1/users/invite
    const formData = new FormData();
    formData.append('account_id', account.account_id);
    formData.append('provider_id', linkedinUrl); // LinkedIn URL or provider ID
    
    if (note) {
      formData.append('message', note);
    }

    console.log(`Sending invite request to Unipile for account ${account.account_id}`);

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
    // RETURN SUCCESS
    // ============================================
    return new Response(JSON.stringify({
      success: true,
      invitationId: responseData.invitation_id || responseData.id,
      status: 'pending', // Invites are always pending until accepted
      message: 'Connection request sent successfully',
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
