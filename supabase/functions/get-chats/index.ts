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

    const { workspaceId, accountId, limit = 50, cursor } = await req.json();

    if (!workspaceId) {
      return new Response(JSON.stringify({ error: 'workspaceId is required' }), { status: 400, headers: corsHeaders });
    }

    // ============================================
    // MEMBERSHIP CHECK: Verify user belongs to workspace
    // ============================================
    const { data: member } = await supabase
      .from('workspace_members')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('user_id', claimsData.user.id)
      .maybeSingle();

    if (!member) {
      return new Response(JSON.stringify({ error: 'Not a member of this workspace' }), { status: 403, headers: corsHeaders });
    }

    // ============================================
    // VALIDATE ACCOUNT: If accountId provided, verify it belongs to workspace
    // ============================================
    if (accountId) {
      const { data: account } = await supabase
        .from('accounts')
        .select('id')
        .eq('account_id', accountId)
        .eq('workspace_id', workspaceId)
        .maybeSingle();

      if (!account) {
        return new Response(JSON.stringify({ 
          error: 'Account not found or does not belong to this workspace' 
        }), { status: 403, headers: corsHeaders });
      }
    }

    // ============================================
    // CALL MESSAGING PROVIDER API: Get chats
    // ============================================
    const PROVIDER_DSN = Deno.env.get('UNIPILE_DSN');
    const PROVIDER_API_KEY = Deno.env.get('UNIPILE_API_KEY');

    if (!PROVIDER_DSN || !PROVIDER_API_KEY) {
      console.log('Messaging provider not configured, returning empty chats');
      return new Response(JSON.stringify({
        success: true,
        chats: [],
        message: 'Messaging service not configured',
      }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    let url = `https://${PROVIDER_DSN}/api/v1/chats?limit=${limit}`;
    if (accountId) {
      url += `&account_id=${accountId}`;
    }
    if (cursor) {
      url += `&cursor=${cursor}`;
    }

    const providerResponse = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': PROVIDER_API_KEY,
        'accept': 'application/json',
      },
    });

    if (!providerResponse.ok) {
      const errorText = await providerResponse.text();
      console.error('Provider API error:', providerResponse.status, errorText);
      
      // Return empty array instead of failing
      if (providerResponse.status === 401 || providerResponse.status === 403) {
        return new Response(JSON.stringify({
          success: false,
          error: 'Provider authentication failed',
          chats: [],
        }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }
      
      throw new Error(`Provider API error: ${providerResponse.status}`);
    }

    const providerData = await providerResponse.json();
    console.log(`Retrieved ${providerData.items?.length || 0} chats from provider`);
    
    // Log sample structure for debugging
    if (providerData.items?.length > 0) {
      console.log('Sample chat structure:', JSON.stringify(providerData.items[0]).slice(0, 500));
    }

    // Map provider response to our Chat interface
    const mappedChats = (providerData.items || []).map((chat: any) => {
      // Unipile returns attendees as an array, get the first non-self attendee
      const attendee = chat.attendees?.find((a: any) => a.is_self !== true) || chat.attendees?.[0] || {};
      
      return {
        id: chat.id || chat.chat_id,
        account_id: chat.account_id,
        attendee_name: attendee.display_name || attendee.name || chat.name || 'Sem nome',
        attendee_email: attendee.email || null,
        last_message: chat.last_message?.text || chat.last_message_text || '',
        last_message_at: chat.last_message?.date || chat.last_message_date || chat.updated_at || null,
        unread_count: chat.unread_count || 0,
      };
    });

    return new Response(JSON.stringify({
      success: true,
      chats: mappedChats,
      cursor: providerData.cursor,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (err) {
    const error = err as Error;
    console.error('Error in get-chats:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: corsHeaders });
  }
});
