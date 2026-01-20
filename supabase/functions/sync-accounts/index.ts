import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProviderAccount {
  id: string;
  name?: string;
  type?: string;
  status?: string;
  sources?: Array<{ type: string }>;
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

    const { workspaceId } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId is required' }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // ADMIN CHECK: Only admins can sync accounts
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
    // FETCH FROM PROVIDER: Get connected accounts
    // ============================================
    const PROVIDER_DSN = Deno.env.get('UNIPILE_DSN');
    const PROVIDER_API_KEY = Deno.env.get('UNIPILE_API_KEY');

    if (!PROVIDER_DSN || !PROVIDER_API_KEY) {
      console.log('Messaging provider not configured, returning empty accounts');
      return new Response(JSON.stringify({
        success: true,
        accounts: [],
        synced: 0,
        message: 'Messaging service not configured',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const providerResponse = await fetch(`https://${PROVIDER_DSN}/api/v1/accounts`, {
      method: 'GET',
      headers: {
        'X-API-KEY': PROVIDER_API_KEY,
        'accept': 'application/json',
      },
    });

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text();
      console.error('Provider API error:', providerResponse.status, errorText);
      
      if (providerResponse.status === 401 || providerResponse.status === 403) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Provider authentication failed',
        }), { status: 401, headers: corsHeaders });
      }
      
      throw new Error(`Provider API error: ${providerResponse.status}`);
    }

    const providerData = await providerResponse.json();
    const providerAccounts: ProviderAccount[] = providerData.items || providerData || [];
    
    console.log(`Retrieved ${providerAccounts.length} accounts from provider`);

    // ============================================
    // SYNC ACCOUNTS: Upsert to database
    // ============================================
    const serviceSupabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    // Get existing accounts
    const { data: existingAccounts } = await serviceSupabase
      .from('accounts')
      .select('id, account_id')
      .eq('workspace_id', workspaceId);

    const existingAccountIds = new Set(existingAccounts?.map(a => a.account_id) || []);
    const providerAccountIds = new Set(providerAccounts.map(a => a.id));

    // Upsert accounts from provider
    let syncedCount = 0;
    for (const account of providerAccounts) {
      // Determine channel from account type/sources
      let channel = 'unknown';
      if (account.type) {
        channel = account.type.toLowerCase();
      } else if (account.sources?.length) {
        const sourceTypes = account.sources.map(s => s.type?.toLowerCase());
        if (sourceTypes.includes('whatsapp')) channel = 'whatsapp';
        else if (sourceTypes.includes('linkedin')) channel = 'linkedin';
        else if (sourceTypes.includes('email') || sourceTypes.includes('mail')) channel = 'email';
        else channel = sourceTypes[0] || 'unknown';
      }

      const accountData = {
        workspace_id: workspaceId,
        account_id: account.id,
        provider: 'messaging',
        channel,
        name: account.name || `Account ${account.id.slice(0, 8)}`,
        status: account.status === 'OK' || account.status === 'CONNECTED' ? 'connected' : 
                account.status === 'DISCONNECTED' ? 'disconnected' : 'connected',
        updated_at: new Date().toISOString(),
      };

      const { error: upsertError } = await serviceSupabase
        .from('accounts')
        .upsert(accountData, {
          onConflict: 'workspace_id,account_id',
        });

      if (upsertError) {
        console.error('Error upserting account:', upsertError);
      } else {
        syncedCount++;
      }
    }

    // Mark removed accounts as disconnected
    for (const existing of existingAccounts || []) {
      if (!providerAccountIds.has(existing.account_id)) {
        await serviceSupabase
          .from('accounts')
          .update({ status: 'disconnected', updated_at: new Date().toISOString() })
          .eq('id', existing.id);
      }
    }

    // Fetch updated accounts
    const { data: updatedAccounts } = await serviceSupabase
      .from('accounts')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });

    console.log(`Synced ${syncedCount} accounts for workspace ${workspaceId}`);

    return new Response(JSON.stringify({
      success: true,
      accounts: updatedAccounts || [],
      synced: syncedCount,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in sync-accounts:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
