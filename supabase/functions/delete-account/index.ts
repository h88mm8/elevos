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

    const userId = claimsData.user.id;
    const { workspaceId, accountId } = await req.json();

    if (!workspaceId || !accountId) {
      return new Response(JSON.stringify({ error: 'workspaceId and accountId are required' }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // ADMIN CHECK: Verify user is admin of workspace
    // ============================================
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id, role')
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), { status: 403, headers: corsHeaders });
    }

    if (member.role !== 'admin') {
      return new Response(JSON.stringify({ error: 'Only admins can remove accounts' }), { status: 403, headers: corsHeaders });
    }

    // ============================================
    // GET ACCOUNT: Fetch account_id (provider ID) before deletion
    // ============================================
    const { data: account, error: fetchError } = await supabase
      .from('accounts')
      .select('account_id')
      .eq('id', accountId)
      .eq('workspace_id', workspaceId)
      .maybeSingle();

    if (fetchError || !account) {
      console.error('Error fetching account:', fetchError);
      return new Response(JSON.stringify({ error: 'Account not found' }), { status: 404, headers: corsHeaders });
    }

    const providerAccountId = account.account_id;

    // ============================================
    // DELETE FROM UNIPILE: Remove connection from provider
    // ============================================
    const unipileDsn = Deno.env.get('UNIPILE_DSN');
    const unipileApiKey = Deno.env.get('UNIPILE_API_KEY');

    if (unipileDsn && unipileApiKey && providerAccountId) {
      try {
        const deleteUrl = `https://${unipileDsn}/api/v1/accounts/${providerAccountId}`;
        console.log(`Deleting account from Unipile: ${deleteUrl}`);
        
        const unipileResponse = await fetch(deleteUrl, {
          method: 'DELETE',
          headers: {
            'X-API-KEY': unipileApiKey,
            'Accept': 'application/json',
          },
        });

        if (!unipileResponse.ok) {
          const errorText = await unipileResponse.text();
          console.warn(`Unipile delete failed (${unipileResponse.status}): ${errorText}`);
          // Continue with local deletion even if Unipile fails
        } else {
          console.log(`Successfully deleted account ${providerAccountId} from Unipile`);
        }
      } catch (unipileError) {
        console.warn('Error calling Unipile delete:', unipileError);
        // Continue with local deletion even if Unipile fails
      }
    }

    // ============================================
    // DELETE ACCOUNT: Remove from accounts table
    // ============================================
    const { error: deleteError } = await supabase
      .from('accounts')
      .delete()
      .eq('id', accountId)
      .eq('workspace_id', workspaceId);

    if (deleteError) {
      console.error('Error deleting account:', deleteError);
      throw new Error('Failed to delete account');
    }

    console.log(`Account ${accountId} deleted from workspace ${workspaceId} by user ${userId}`);

    return new Response(JSON.stringify({
      success: true,
      message: 'Account deleted successfully',
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in delete-account:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
