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

    // ============================================
    // FETCH ATTENDEE PROFILES: Get names for contacts
    // ============================================
    const fetchAttendeeProfile = async (chat: any): Promise<{ displayName: string | null; profilePicture: string | null }> => {
      try {
        const identifier = chat.attendee_public_identifier || chat.attendee_provider_id;
        if (!identifier || !chat.account_id) {
          return { displayName: null, profilePicture: null };
        }

        const profileUrl = `https://${PROVIDER_DSN}/api/v1/users/${encodeURIComponent(identifier)}?account_id=${chat.account_id}`;
        const profileResponse = await fetch(profileUrl, {
          method: 'GET',
          headers: {
            'X-API-KEY': PROVIDER_API_KEY,
            'accept': 'application/json',
          },
        });

        if (!profileResponse.ok) {
          console.log(`Could not fetch profile for ${identifier}: ${profileResponse.status}`);
          return { displayName: null, profilePicture: null };
        }

        const profile = await profileResponse.json();
        const displayName = profile.display_name || profile.name || 
                           (profile.first_name && profile.last_name ? `${profile.first_name} ${profile.last_name}` : null) ||
                           profile.first_name || null;
        return { 
          displayName, 
          profilePicture: profile.profile_picture_url || profile.profile_picture || null 
        };
      } catch (err) {
        console.log(`Error fetching profile: ${err}`);
        return { displayName: null, profilePicture: null };
      }
    };

    // Fetch profiles in parallel (limit concurrent requests to avoid rate limiting)
    const chatItems = providerData.items || [];
    const batchSize = 10;
    const profiles: Map<string, { displayName: string | null; profilePicture: string | null }> = new Map();

    for (let i = 0; i < chatItems.length; i += batchSize) {
      const batch = chatItems.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(async (chat: any) => ({
          chatId: chat.id,
          profile: await fetchAttendeeProfile(chat),
        }))
      );
      results.forEach(r => profiles.set(r.chatId, r.profile));
    }

    // Map provider response to our Chat interface with fetched names
    const mappedChats = chatItems.map((chat: any) => {
      const profile = profiles.get(chat.id);
      const attendeeIdentifier = chat.attendee_public_identifier || chat.attendee_provider_id || '';
      const phoneNumber = attendeeIdentifier.split('@')[0] || '';
      const formattedPhone = phoneNumber ? `+${phoneNumber.slice(0, 2)} ${phoneNumber.slice(2)}` : '';
      
      return {
        id: chat.id || chat.chat_id,
        account_id: chat.account_id,
        attendee_name: profile?.displayName || chat.name || formattedPhone || 'Contato',
        attendee_email: null,
        attendee_picture: profile?.profilePicture || null,
        last_message: chat.last_message?.text || chat.snippet || '',
        last_message_at: chat.timestamp || chat.last_message?.date || null,
        unread_count: chat.unread_count || chat.unread || 0,
      };
    });

    console.log(`Mapped ${mappedChats.length} chats with profiles`);

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
