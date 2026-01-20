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

    const { workspaceId, account_id, channel, name } = await req.json();

    if (!workspaceId || !account_id || !channel) {
      return new Response(JSON.stringify({ error: 'workspaceId, account_id, and channel are required' }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // ADMIN CHECK: Only admins can save accounts
    // ============================================
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', claimsData.user.id)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), { status: 403, headers: corsHeaders });
    }

    if (member.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Admin access required' }), { status: 403, headers: corsHeaders });
    }

    // ============================================
    // UPSERT ACCOUNT: Save to database
    // ============================================
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const accountData = {
      workspace_id: workspaceId,
      account_id: account_id,
      provider: 'messaging',
      channel,
      name: name || `Account ${account_id.slice(0, 8)}`,
      status: 'connected',
      updated_at: new Date().toISOString(),
    };

    const { data: savedAccount, error: upsertError } = await serviceSupabase
      .from('accounts')
      .upsert(accountData, {
        onConflict: 'workspace_id,account_id',
      })
      .select()
      .single();

    if (upsertError) {
      console.error('Error upserting account:', upsertError);
      return new Response(JSON.stringify({ error: 'Failed to save account' }), { status: 500, headers: corsHeaders });
    }

    console.log(`Account ${account_id} saved for workspace ${workspaceId}`);

    return new Response(JSON.stringify({
      success: true,
      account: savedAccount,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in save-account:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
